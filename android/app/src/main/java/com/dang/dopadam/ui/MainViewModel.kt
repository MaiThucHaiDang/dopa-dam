package com.dang.dopadam.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.dang.dopadam.DopaDamApp
import com.dang.dopadam.core.DAY_MS
import com.dang.dopadam.core.Settings
import com.dang.dopadam.core.StudyRule
import com.dang.dopadam.core.StudyStatus
import com.dang.dopadam.core.formatStudyDays
import com.dang.dopadam.core.shortDate
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

    val studyRules: StateFlow<List<StudyRule>> = repo.observeStudyRules()
        .map { list -> list.sortedWith(compareBy({ it.start }, { it.days.firstOrNull() ?: 8 })) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

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
        viewModelScope.launch {
            when (val error = pending.run()) {
                null -> syncSoon()
                else -> _message.value = error.message
            }
            refreshToday()
        }
    }

    /** Sends a change to the other devices right away (when signed in) instead of on the next round. */
    private fun syncSoon() {
        val app = getApplication<DopaDamApp>()
        app.appScope.launch { app.sync.maybeSync(minIntervalMs = 0) }
    }

    /** Runs a change; if it weakens protection, asks for the confirmation and then runs it confirmed. */
    private fun submit(action: String, change: suspend (confirmed: Boolean) -> ErrorCode?) {
        viewModelScope.launch {
            when (val error = change(false)) {
                null -> syncSoon()
                ErrorCode.NEEDS_CONFIRM -> _pending.value = PendingConfirm(action) { change(true) }
                else -> _message.value = error.message
            }
            refreshToday()
        }
    }

    fun startStudy(minutes: Int, label: String?) = submit("Bật phiên học $minutes phút.") {
        repo.startStudy(minutes, label, System.currentTimeMillis())
    }

    fun stopStudy() = submit("Kết thúc giờ học ngay bây giờ: cảnh báo trở về mức bình thường và cài đặt được mở khóa.") { confirmed ->
        repo.stopStudy(confirmed, System.currentTimeMillis())
    }

    fun addStudyRule(rule: StudyRule) = submit("Thêm khung giờ học.") { confirmed ->
        repo.setStudyRule(rule, confirmed, System.currentTimeMillis())
    }

    fun skipStudyDay(rule: StudyRule, date: String) = submit("Bỏ qua khung giờ học ngày ${shortDate(date)}.") { confirmed ->
        repo.setStudyRule(rule.copy(exceptions = rule.exceptions + date), confirmed, System.currentTimeMillis())
    }

    fun deleteStudyRule(rule: StudyRule) =
        submit("Xóa khung giờ học ${formatStudyDays(rule.days)} ${rule.start}–${rule.end}.") { confirmed ->
            repo.deleteStudyRule(rule.id, confirmed, System.currentTimeMillis())
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

    /** Deletes the account's data on the server and the log here, then signs out (after the confirmation). */
    fun deleteServerData() = submit("Xóa toàn bộ dữ liệu của tài khoản trên server và nhật ký trên điện thoại, rồi đăng xuất.") { confirmed ->
        if (!confirmed) {
            ErrorCode.NEEDS_CONFIRM
        } else {
            (getApplication<DopaDamApp>()).sync.deleteServerData()?.let { _message.value = it }
            null
        }
    }
}
