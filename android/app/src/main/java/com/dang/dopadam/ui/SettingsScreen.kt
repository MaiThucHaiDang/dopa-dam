package com.dang.dopadam.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.dang.dopadam.BuildConfig
import com.dang.dopadam.core.Tag
import com.dang.dopadam.ui.theme.Tokens

private val LEVEL_LABELS = listOf(
    "Cấp 0 · lần đầu trong giờ",
    "Cấp 1 · lần 2–3",
    "Cấp 2 · từ lần 4",
    "Cấp 3 · đang học hoặc vượt ngân sách",
)

@Composable
private fun NumberField(label: String, value: String, onChange: (String) -> Unit, modifier: Modifier = Modifier) {
    OutlinedTextField(
        value = value,
        onValueChange = { onChange(it.filter(Char::isDigit).take(4)) },
        label = { Text(label) },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        modifier = modifier.fillMaxWidth(),
    )
}

@Composable
fun SettingsScreen(vm: MainViewModel, openGuide: () -> Unit, accountSection: @Composable () -> Unit = {}) {
    val settings by vm.settings.collectAsStateWithLifecycle()
    val protection by vm.protection.collectAsStateWithLifecycle()
    val locks = remember(settings) { mutableStateListOf(*settings.lockSeconds.map { it.toString() }.toTypedArray()) }
    var budget by remember(settings) { mutableStateOf(settings.budgetMinutes.toString()) }
    var gameDelay by remember(settings) { mutableStateOf((settings.tagDelays[Tag.GAME.id] ?: 0).toString()) }
    var entDelay by remember(settings) { mutableStateOf((settings.tagDelays[Tag.ENTERTAINMENT.id] ?: 0).toString()) }

    Column(
        Modifier
            .verticalScroll(rememberScrollState())
            .padding(Tokens.SpaceMd),
        verticalArrangement = Arrangement.spacedBy(Tokens.SpaceMd),
    ) {
        Text("Cài đặt", style = MaterialTheme.typography.headlineSmall)

        SectionCard("Mức cản trở") {
            Muted("Số giây khóa nút Vào ở mỗi cấp. Tăng thì áp dụng ngay, giảm thì cần xác nhận.")
            LEVEL_LABELS.forEachIndexed { i, label -> NumberField(label, locks[i], { locks[i] = it }) }
            NumberField("Ngân sách giải trí mỗi ngày (phút, 0 = tắt)", budget, { budget = it })
            Muted("Độ trễ cảnh báo mặc định: cảnh báo chỉ hiện sau khi app đã mở đủ số giây này (cho game kịp tải).")
            NumberField("Độ trễ cho Game (giây, tối đa 120)", gameDelay, { gameDelay = it })
            NumberField("Độ trễ cho Giải trí (giây)", entDelay, { entDelay = it })
            Button(onClick = {
                val delays = settings.tagDelays.toMutableMap()
                delays[Tag.GAME.id] = gameDelay.toIntOrNull() ?: 0
                delays[Tag.ENTERTAINMENT.id] = entDelay.toIntOrNull() ?: 0
                vm.saveSettings(
                    settings.copy(
                        lockSeconds = locks.map { it.toIntOrNull() ?: 0 },
                        budgetMinutes = budget.toIntOrNull() ?: 0,
                        tagDelays = delays.filterValues { it > 0 },
                    ),
                )
            }) { Text("Lưu") }
        }

        accountSection()

        SectionCard("Bảo vệ và nhật ký") {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                Text(if (protection) "Bảo vệ đang bật" else "Bảo vệ đang tắt")
                Switch(checked = protection, onCheckedChange = { vm.setProtection(it) })
            }
            OutlinedButton(onClick = vm::clearLog) { Text("Xóa nhật ký") }
        }

        OutlinedButton(onClick = openGuide, modifier = Modifier.fillMaxWidth()) { Text("Hướng dẫn và kiểm tra quyền") }
        Muted("DopaDam ${BuildConfig.VERSION_NAME}")
    }
}
