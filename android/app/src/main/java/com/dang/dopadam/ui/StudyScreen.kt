// FR09 on the phone: start a study session by hand, or set weekly study hours. Ending early and
// weakening a rule go through the FR14 confirmation (MainViewModel.submit).
package com.dang.dopadam.ui

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.dang.dopadam.core.MANUAL_STUDY_MINUTES
import com.dang.dopadam.core.STUDY_LABEL_MAX
import com.dang.dopadam.core.StudyRule
import com.dang.dopadam.core.StudySource
import com.dang.dopadam.core.formatStudyDays
import com.dang.dopadam.core.shortDate
import com.dang.dopadam.ui.theme.Tokens
import kotlinx.coroutines.delay
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val WEEKDAYS = listOf(1 to "T2", 2 to "T3", 3 to "T4", 4 to "T5", 5 to "T6", 6 to "T7", 7 to "CN")

private fun sourceText(source: StudySource?) = when (source) {
    StudySource.MANUAL -> "bật tay"
    StudySource.RULE -> "theo khung giờ"
    StudySource.TASKFLOW -> "theo TaskFlow"
    null -> "đang bật"
}

private fun clock(at: Long): String =
    DateTimeFormatter.ofPattern("HH:mm").format(java.time.Instant.ofEpochMilli(at).atZone(ZoneId.systemDefault()))

private fun hm(h: Int, m: Int) = "${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}"

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun StudyScreen(vm: MainViewModel) {
    val context = LocalContext.current
    val today by vm.today.collectAsStateWithLifecycle()
    val rules by vm.studyRules.collectAsStateWithLifecycle()
    var label by remember { mutableStateOf("") }
    var days by remember { mutableStateOf(listOf(1, 2, 3, 4, 5)) }
    var start by remember { mutableStateOf("19:30") }
    var end by remember { mutableStateOf("22:00") }
    var ruleLabel by remember { mutableStateOf("") }

    // Weekly windows start and end with the clock, not with a change in the data.
    LaunchedEffect(Unit) {
        while (true) {
            vm.refreshToday()
            delay(30_000)
        }
    }

    fun pickTime(current: String, onPicked: (String) -> Unit) {
        val (h, m) = current.split(":").map { it.toInt() }
        TimePickerDialog(context, { _, hour, minute -> onPicked(hm(hour, minute)) }, h, m, true).show()
    }

    fun pickSkipDay(rule: StudyRule) {
        val now = LocalDate.now()
        DatePickerDialog(context, { _, y, month, d ->
            vm.skipStudyDay(rule, LocalDate.of(y, month + 1, d).toString())
        }, now.year, now.monthValue - 1, now.dayOfMonth).apply {
            datePicker.minDate = System.currentTimeMillis() - 1000
        }.show()
    }

    Column(
        Modifier
            .verticalScroll(rememberScrollState())
            .padding(Tokens.SpaceMd),
        verticalArrangement = Arrangement.spacedBy(Tokens.SpaceMd),
    ) {
        Text("Chế độ Học", style = MaterialTheme.typography.headlineSmall)
        Muted(
            "Trong giờ học, nút Vào khóa 30 giây, chỉ cho vào 5 hoặc 10 phút, và các cài đặt bị khóa. " +
                "Khi đã đăng nhập, bật ở điện thoại thì máy tính cũng vào giờ học, và ngược lại.",
        )

        val study = today.study
        SectionCard("Bây giờ") {
            if (study.active && study.endsAt != null) {
                Text("Đang học: ${study.label} (${sourceText(study.source)}), đến ${clock(study.endsAt)}.")
                Muted("Học thêm:")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Tokens.SpaceSm)) {
                    for (m in MANUAL_STUDY_MINUTES) {
                        OutlinedButton(onClick = { vm.startStudy(m, study.label) }) { Text("$m phút") }
                    }
                }
                TextButton(onClick = vm::stopStudy) { Text("Kết thúc sớm") }
            } else {
                OutlinedTextField(
                    value = label,
                    onValueChange = { label = it.take(STUDY_LABEL_MAX) },
                    label = { Text("Học gì? (không bắt buộc)") },
                    placeholder = { Text("vd: Ôn Hệ điều hành") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Tokens.SpaceSm)) {
                    for (m in MANUAL_STUDY_MINUTES) {
                        Button(onClick = {
                            vm.startStudy(m, label.trim().ifEmpty { null })
                            label = ""
                        }) { Text("Học $m phút") }
                    }
                }
            }
        }

        SectionCard("Khung giờ cố định") {
            Muted(
                "Tự vào giờ học theo lịch tuần. Thêm khung hoặc kéo dài thì không cần xác nhận; xóa, rút ngắn hoặc bỏ qua " +
                    "hôm nay thì phải xác nhận, và bị khóa khi đang học.",
            )
            if (rules.isEmpty()) Muted("Chưa có khung giờ nào.")
            val todayDate = LocalDate.now().toString()
            for (rule in rules) {
                HorizontalDivider(color = Tokens.Border)
                Text(
                    "${formatStudyDays(rule.days)} · ${rule.start}–${rule.end}" + (rule.label?.let { " · $it" } ?: ""),
                    fontWeight = FontWeight.Medium,
                )
                val upcoming = rule.exceptions.filter { it >= todayDate }
                if (upcoming.isNotEmpty()) Muted("Bỏ qua: ${upcoming.joinToString(", ") { shortDate(it) }}")
                Row(horizontalArrangement = Arrangement.spacedBy(Tokens.SpaceSm)) {
                    TextButton(onClick = { pickSkipDay(rule) }) { Text("Bỏ qua một ngày") }
                    TextButton(onClick = { vm.deleteStudyRule(rule) }) { Text("Xóa") }
                }
            }
        }

        SectionCard("Thêm khung giờ") {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Tokens.SpaceXs)) {
                for ((d, name) in WEEKDAYS) {
                    FilterChip(
                        selected = d in days,
                        onClick = { days = if (d in days) days - d else days + d },
                        label = { Text(name) },
                    )
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Tokens.SpaceSm)) {
                OutlinedButton(onClick = { pickTime(start) { start = it } }) { Text("Từ $start") }
                OutlinedButton(onClick = { pickTime(end) { end = it } }) { Text("Đến $end") }
            }
            OutlinedTextField(
                value = ruleLabel,
                onValueChange = { ruleLabel = it.take(STUDY_LABEL_MAX) },
                label = { Text("Nhãn (không bắt buộc)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Muted("Giờ kết thúc sớm hơn giờ bắt đầu nghĩa là khung kéo qua nửa đêm.")
            Button(
                enabled = days.isNotEmpty() && start != end,
                onClick = {
                    vm.addStudyRule(StudyRule("", days.sorted(), start, end, ruleLabel.trim().ifEmpty { null }, emptyList()))
                    ruleLabel = ""
                },
            ) { Text("Thêm khung giờ") }
        }
    }
}
