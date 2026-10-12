package com.dang.dopadam.service

import android.accessibilityservice.AccessibilityService
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.accessibility.AccessibilityEvent
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.dang.dopadam.DopaDamApp
import com.dang.dopadam.core.Settings
import com.dang.dopadam.core.Tag
import com.dang.dopadam.core.effectiveDelay
import com.dang.dopadam.data.AllowWindowEntity
import com.dang.dopadam.data.KIND_APP
import com.dang.dopadam.data.TagRuleEntity
import com.dang.dopadam.logic.ACTIVITIES
import com.dang.dopadam.logic.Decision
import com.dang.dopadam.logic.OpenTracker
import com.dang.dopadam.ui.warning.WarningActions
import com.dang.dopadam.ui.warning.WarningUiState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.lang.ref.WeakReference
import java.util.UUID
import kotlin.math.ceil

/**
 * Watches which app comes to the front (window-state events only, never screen content) and covers
 * entertainment apps with the warning overlay. Also counts time per tag for the daily budget.
 */
class GuardService : AccessibilityService() {
    private val repo get() = (application as DopaDamApp).repository
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val handler = Handler(Looper.getMainLooper())
    private val tracker = OpenTracker()

    private var ignored: Set<String> = emptySet()
    private var rules: Map<String, TagRuleEntity> = emptyMap()
    private var settings = Settings()
    private val windows = HashMap<String, AllowWindowEntity>()

    private var foreground: String? = null
    private var segmentStart = 0L
    private var lastFlush = 0L
    private var screenOn = true

    private var overlay: WarningOverlay? = null
    private var overlayPkg: String? = null
    private var overlayEventId: String? = null
    private var focusRequest: AudioFocusRequest? = null
    private var justExited: String? = null
    private var justExitedUntil = 0L

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val now = System.currentTimeMillis()
            when (intent.action) {
                Intent.ACTION_SCREEN_OFF -> {
                    flushUsage(now)
                    screenOn = false
                    overlayEventId?.let { id -> scope.launch { repo.autoExit(id, now) } }
                    dismissOverlay()
                }
                Intent.ACTION_SCREEN_ON -> {
                    screenOn = true
                    segmentStart = now
                }
                Intent.ACTION_USER_PRESENT -> foreground?.let { evaluate(it, now) }
                Intent.ACTION_PACKAGE_ADDED -> onPackageAdded(intent)
            }
        }
    }

    private val tick = object : Runnable {
        override fun run() {
            onTick(System.currentTimeMillis())
            handler.postDelayed(this, TICK_MS)
        }
    }

    override fun onServiceConnected() {
        instance = WeakReference(this)
        ignored = setOf("android", "com.android.systemui") + InstalledApps.keyboardPackages(this)
        startGuardForeground()
        ContextCompat.registerReceiver(
            this,
            receiver,
            IntentFilter().apply {
                addAction(Intent.ACTION_SCREEN_OFF)
                addAction(Intent.ACTION_SCREEN_ON)
                addAction(Intent.ACTION_USER_PRESENT)
            },
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        ContextCompat.registerReceiver(
            this,
            receiver,
            IntentFilter(Intent.ACTION_PACKAGE_ADDED).apply { addDataScheme("package") },
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        scope.launch { repo.observeRules().collect { list -> rules = list.filter { it.kind == KIND_APP }.associateBy { it.pattern } } }
        scope.launch { repo.observeSettings().collect { settings = it } }
        scope.launch { repo.allowWindows().forEach { windows[it.obj] = it } }
        Notifier.cancelAccessibilityLost(this)
        handler.post(tick)
    }

    private fun startGuardForeground() {
        // Keeps the process in the foreground class so aggressive phones are less likely to kill it.
        try {
            val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            } else {
                0
            }
            ServiceCompat.startForeground(this, Notifier.ID_GUARD, Notifier.guard(this), type)
        } catch (e: RuntimeException) {
            // The accessibility service keeps working without the foreground notification.
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val pkg = event.packageName?.toString() ?: return
        if (pkg in ignored) return
        // Our overlay window also produces events (when it appears and when it goes away): only
        // DopaDam's own screen counts as switching to DopaDam.
        if (pkg == packageName && event.className?.toString()?.endsWith(".MainActivity") != true) return
        val now = System.currentTimeMillis()
        // Right after Thoát the blocked app may still report itself while the home screen opens.
        if (pkg == justExited && now < justExitedUntil) return
        onForeground(pkg, now)
    }

    override fun onInterrupt() = Unit

    override fun onDestroy() {
        flushUsage(System.currentTimeMillis())
        handler.removeCallbacksAndMessages(null)
        dismissOverlay()
        runCatching { unregisterReceiver(receiver) }
        scope.cancel()
        instance = null
        super.onDestroy()
    }

    private fun onForeground(pkg: String, now: Long) {
        if (pkg == foreground) return
        flushUsage(now)
        foreground?.let { tracker.leave(it, now) }
        foreground = pkg
        segmentStart = now
        tracker.enter(pkg, now)
        if (overlay != null && pkg != overlayPkg) {
            // Left the warning with a system gesture instead of a button: counts as Thoát.
            overlayEventId?.let { id -> scope.launch { repo.autoExit(id, now) } }
            dismissOverlay()
        }
        evaluate(pkg, now)
    }

    private fun blockedRule(pkg: String): TagRuleEntity? = rules[pkg]?.takeIf { Tag.fromId(it.tag)?.blocked == true }

    /** Shows the warning for pkg if it is blocked, not allowed right now, and its delay is over. */
    private fun evaluate(pkg: String, now: Long) {
        if (!screenOn || overlay != null || !repo.prefs.protectionEnabled) return
        val rule = blockedRule(pkg) ?: return
        val window = windows[pkg]
        if (window != null && window.expiresAt > now) return
        val delayMs = effectiveDelay(rule.delaySeconds, rule.tag, settings.tagDelays) * 1000L
        if (!tracker.isDue(pkg, now, delayMs)) return
        showWarning(pkg, rule.tag, now)
    }

    private fun onTick(now: Long) {
        if (!screenOn) return
        for (window in windows.values.toList()) {
            if (!window.headsUpSent && now >= window.expiresAt - 60_000 && now < window.expiresAt) {
                val sent = window.copy(headsUpSent = true)
                windows[window.obj] = sent
                scope.launch { repo.markHeadsUpSent(window) }
                Notifier.headsUp(this, InstalledApps.label(this, window.obj))
            }
            if (now >= window.expiresAt) {
                windows.remove(window.obj)
                scope.launch { repo.removeAllowWindow(window.obj) }
            }
        }
        foreground?.let { evaluate(it, now) }
        if (now - lastFlush >= 60_000) flushUsage(now)
    }

    /** Adds the time since the last flush to the tag of the app in front (not while the warning covers it). */
    private fun flushUsage(now: Long) {
        lastFlush = now
        val pkg = foreground
        val start = segmentStart
        segmentStart = now
        if (pkg == null || !screenOn || overlay != null || now <= start) return
        val tag = rules[pkg]?.tag ?: return
        if (tag == Tag.IGNORE.id) return
        val seconds = (now - start) / 1000.0
        scope.launch { repo.addUsage(tag, seconds, now) }
    }

    private fun showWarning(pkg: String, tag: String, now: Long) {
        flushUsage(now)
        tracker.markWarned(pkg)
        val eventId = UUID.randomUUID().toString()
        val ov = WarningOverlay(this, actionsFor(pkg, eventId))
        overlay = ov
        overlayPkg = pkg
        overlayEventId = eventId
        ov.show()
        requestAudioFocus()
        scope.launch {
            val (_, plan) = repo.recordWarning(eventId, pkg, tag, now)
            val budget = repo.budgetView(now)
            val study = repo.studyStatus(now)
            if (overlay !== ov) return@launch
            ov.update(
                WarningUiState(
                    appLabel = InstalledApps.label(this@GuardService, pkg),
                    countThisHour = plan.n + 1,
                    lockSeconds = plan.lockSeconds,
                    allowOptions = plan.allowOptions,
                    usedMinutes = budget.usedMinutes,
                    budgetMinutes = budget.budgetMinutes,
                    studyLabel = if (study.active) study.label else null,
                    studyMinutesLeft = study.endsAt?.let { ceil((it - now) / 60_000.0).toInt() },
                    activities = ACTIVITIES,
                ),
            )
        }
    }

    private fun actionsFor(pkg: String, eventId: String) = object : WarningActions {
        override fun exit() {
            val now = System.currentTimeMillis()
            scope.launch { repo.decide(eventId, Decision.EXIT, null, null, null, now) }
            leaveToHome(pkg, now)
        }

        override fun enter(minutes: Int) {
            val now = System.currentTimeMillis()
            scope.launch {
                val error = repo.decide(eventId, Decision.ENTER, minutes, null, null, now)
                if (error == null) {
                    windows[pkg] = AllowWindowEntity(pkg, now + minutes * 60_000L)
                    segmentStart = System.currentTimeMillis()
                    dismissOverlay()
                } else {
                    overlay?.let { ov -> ov.current()?.let { ov.update(it.copy(error = error.message)) } }
                }
            }
        }

        override fun alternative(activity: String, minutes: Int) {
            val now = System.currentTimeMillis()
            scope.launch {
                if (repo.decide(eventId, Decision.ALTERNATIVE, null, activity, minutes, now) != null) return@launch
                val studyLabel = overlay?.current()?.studyLabel
                leaveToHome(pkg, now)
                val endsAt = now + minutes * 60_000L
                Notifier.timerRunning(this@GuardService, activity, endsAt)
                handler.postDelayed({ Notifier.timerDone(this@GuardService, activity, minutes, studyLabel) }, endsAt - now)
            }
        }
    }

    private fun leaveToHome(pkg: String, now: Long) {
        justExited = pkg
        justExitedUntil = now + EXIT_GRACE_MS
        dismissOverlay()
        // We are sending the user home: stop treating the blocked app as the one in front right away,
        // otherwise the next tick could warn again before the home screen reports itself.
        if (foreground == pkg) {
            tracker.leave(pkg, now)
            foreground = null
        }
        performGlobalAction(GLOBAL_ACTION_HOME)
    }

    private fun dismissOverlay() {
        overlay?.dismiss()
        overlay = null
        overlayPkg = null
        overlayEventId = null
        abandonAudioFocus()
    }

    /** Taking audio focus makes most video apps pause behind the warning. */
    private fun requestAudioFocus() {
        val audio = getSystemService(AudioManager::class.java) ?: return
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build(),
            )
            .build()
        audio.requestAudioFocus(request)
        focusRequest = request
    }

    private fun abandonAudioFocus() {
        val request = focusRequest ?: return
        getSystemService(AudioManager::class.java)?.abandonAudioFocusRequest(request)
        focusRequest = null
    }

    private fun onPackageAdded(intent: Intent) {
        if (intent.getBooleanExtra(Intent.EXTRA_REPLACING, false)) return
        val pkg = intent.data?.schemeSpecificPart ?: return
        if (rules.containsKey(pkg) || !InstalledApps.isLauncherApp(this, pkg)) return
        Notifier.newApp(this, pkg, InstalledApps.label(this, pkg))
    }

    companion object {
        private const val TICK_MS = 2000L
        private const val EXIT_GRACE_MS = 1500L

        @Volatile
        private var instance: WeakReference<GuardService>? = null

        /** True while the system has the service connected (it can still be enabled but killed). */
        val isRunning: Boolean get() = instance?.get() != null
    }
}
