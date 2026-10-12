package com.dang.dopadam.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.dang.dopadam.DopaDamApp
import com.dang.dopadam.core.DAY_MS
import com.dang.dopadam.core.Settings
import com.dang.dopadam.core.StudyStatus
import com.dang.dopadam.core.Tag
import com.dang.dopadam.core.dayKey
import com.dang.dopadam.core.localTzOffsetMinutes
import com.dang.dopadam.data.BudgetView
import com.dang.dopadam.data.InterceptEventEntity
import com.dang.dopadam.data.KIND_APP
import com.dang.dopadam.data.TagRuleEntity
import com.dang.dopadam.logic.ErrorCode
import com.dang.dopadam.service.InstalledApp
import com.dang.dopadam.service.InstalledApps
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class TodaySummary(val warnings: Int, val exits: Int, val budget: BudgetView?, val study: StudyStatus)

/** A change waiting for the user to pass the 60-second confirmation. */
data class PendingConfirm(val action: String, val run: suspend () -> ErrorCode?)

class MainViewModel(application: Application) : AndroidViewModel(application) {
    private val repo = (application as DopaDamApp).repository

    val rules: StateFlow<Map<String, TagRuleEntity>> = repo.observeRules()
        .map { list -> list.filter { it.kind == KIND_APP }.associateBy { it.pattern } }
        .stateIn(viewModelScope, SharingStarted.Eagerly, emptyMap())

    val settings: StateFlow<Settings> = repo.observeSettings().stateIn(viewModelScope, SharingStarted.Eagerly, Settings())

    private val _apps = MutableStateFlow<List<InstalledApp>?>(null)
    val apps: StateFlow<List<InstalledApp>?> = _apps.asStateFlow()

    private val _protection = MutableStateFlow(repo.prefs.protectionEnabled)
    val protection: StateFlow<Boolean> = _protection.asStateFlow()

    private val _today = MutableStateFlow(TodaySummary(0, 0, null, StudyStatus.NONE))
    val today: StateFlow<TodaySummary> = _today.asStateFlow()

    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()

    private val _pending = MutableStateFlow<PendingConfirm?>(null)
    val pending: StateFlow<PendingConfirm?> = _pending.asStateFlow()

    init {
        refreshApps()
        viewModelScope.launch {
            repo.db.events().observeSince(System.currentTimeMillis() - DAY_MS).collect { refreshToday(it) }
        }
    }

    fun refreshApps() {
        viewModelScope.launch {
            val list = withContext(Dispatchers.IO) { InstalledApps.launcherApps(getApplication()) }
            repo.applyDefaultTags(list.map { it.pkg to it.isGame }, System.currentTimeMillis())
            _apps.value = list
        }
    }

    fun refreshToday() {
        viewModelScope.launch { refreshToday(repo.db.events().since(System.currentTimeMillis() - DAY_MS)) }
    }

    private suspend fun refreshToday(events: List<InterceptEventEntity>) {
        val now = System.currentTimeMillis()
        val tz = localTzOffsetMinutes(now)
        val today = dayKey(now, tz)
        val todays = events.filter { dayKey(it.shownAt, tz) == today }
        _today.value = TodaySummary(
            warnings = todays.size,
            exits = todays.count { it.decision == "exit" },
            budget = repo.budgetView(now),
            study = repo.studyStatus(now),
        )
        _protection.value = repo.prefs.protectionEnabled
    }

    fun dismissMessage() {
        _message.value = null
    }

    fun cancelPending() {
        _pending.value = null
    }

    fun confirmPending() {
        val pending = _pending.value ?: return
        _pending.value = null
        viewModelScope.launch { pending.run()?.let { _message.value = it.message } ; refreshToday() }
    }

    /** Runs a change; if it weakens protection, asks for the confirmation and then runs it confirmed. */
    private fun submit(action: String, change: suspend (confirmed: Boolean) -> ErrorCode?) {
        viewModelScope.launch {
            when (val error = change(false)) {
                null -> Unit
                ErrorCode.NEEDS_CONFIRM -> _pending.value = PendingConfirm(action) { change(true) }
                else -> _message.value = error.message
            }
            refreshToday()
        }
    }

    fun setTag(app: InstalledApp, tag: Tag?) = submit(
        if (tag == null) "Bỏ tag của ${app.label}: app này sẽ không bị cảnh báo nữa." else "Đổi ${app.label} sang tag ${tag.label}.",
    ) { confirmed -> repo.setAppTag(app.pkg, tag, confirmed, System.currentTimeMillis()) }

    fun setDelay(app: InstalledApp, seconds: Int?) = submit("Tăng độ trễ cảnh báo của ${app.label}.") { confirmed ->
        repo.setAppDelay(app.pkg, seconds, confirmed, System.currentTimeMillis())
    }

    fun saveSettings(new: Settings) = submit("Giảm thời gian khóa nút Vào, nới ngân sách hoặc tăng độ trễ.") { confirmed ->
        repo.setSettings(new, confirmed, System.currentTimeMillis())
    }

    fun setProtection(enabled: Boolean) = submit("Tắt bảo vệ: mọi app sẽ mở thẳng, không có cảnh báo.") { confirmed ->
        repo.setProtection(enabled, confirmed, System.currentTimeMillis()).also { _protection.value = repo.prefs.protectionEnabled }
    }

    fun clearLog() = submit("Xóa toàn bộ nhật ký chặn và thời gian dùng trên điện thoại.") { confirmed ->
        repo.clearLog(confirmed)
    }
}
