package com.dang.dopadam.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.dang.dopadam.service.GuardService
import com.dang.dopadam.service.Permissions
import com.dang.dopadam.ui.theme.Tokens
import kotlin.math.ceil

@Composable
fun OverviewScreen(vm: MainViewModel, openGuide: () -> Unit, openApps: () -> Unit, openStudy: () -> Unit) {
    val context = LocalContext.current
    val today by vm.today.collectAsStateWithLifecycle()
    val protection by vm.protection.collectAsStateWithLifecycle()
    var resumes by remember { mutableIntStateOf(0) }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        resumes++
        vm.refreshToday()
    }
    val accessibility = remember(resumes) { Permissions.accessibilityEnabled(context) }
    val notifications = remember(resumes) { Permissions.notificationsAllowed(context) }
    val battery = remember(resumes) { Permissions.batteryUnrestricted(context) }
    val missing = listOf(accessibility, notifications, battery).count { !it }

    Column(
        Modifier
            .verticalScroll(rememberScrollState())
            .padding(Tokens.SpaceMd),
        verticalArrangement = Arrangement.spacedBy(Tokens.SpaceMd),
    ) {
        Text("DopaDam", style = MaterialTheme.typography.headlineSmall)
        val status = when {
            !protection -> "Bảo vệ đang TẮT"
            !accessibility -> "Chưa bật quyền Trợ năng: điện thoại chưa được bảo vệ"
            !GuardService.isRunning -> "Đã bật Trợ năng, đang chờ hệ thống khởi động dịch vụ"
            else -> "Bảo vệ đang bật"
        }
        Muted(status)

        if (missing > 0) {
            SectionCard("Còn $missing bước cần làm") {
                Muted("Thiếu quyền thì DopaDam không chặn được hoặc dễ bị hệ thống tắt.")
                Button(onClick = openGuide) { Text("Mở hướng dẫn") }
            }
        }

        SectionCard("Hôm nay") {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Muted("Bị chặn")
                Text("${today.warnings}")
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Muted("Chọn Thoát")
                Text("${today.exits}")
            }
            today.budget?.let { b ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Muted("Giải trí")
                    Text(if (b.budgetMinutes > 0) "${b.usedMinutes.toInt()} / ${b.budgetMinutes} phút" else "${b.usedMinutes.toInt()} phút")
                }
            }
        }

        if (today.study.active) {
            SectionCard("Đang học") {
                val left = today.study.endsAt?.let { ceil((it - System.currentTimeMillis()) / 60_000.0).toInt() }
                Text(today.study.label ?: "")
                left?.let { Muted("Còn $it phút. Nút Vào khóa lâu hơn và cài đặt bị khóa.") }
                OutlinedButton(onClick = openStudy) { Text("Mở Chế độ Học") }
            }
        } else {
            SectionCard("Chế độ Học") {
                Muted("Bật khi ngồi vào học: cảnh báo khóa nút Vào lâu hơn và chỉ cho vào 5 hoặc 10 phút.")
                OutlinedButton(onClick = openStudy) { Text("Bật Chế độ Học") }
            }
        }

        SectionCard("Gán tag cho app") {
            Muted("App gắn tag Giải trí hoặc Game sẽ hiện cảnh báo khi mở.")
            OutlinedButton(onClick = openApps) { Text("Mở danh sách app") }
        }

        OutlinedButton(onClick = openGuide, modifier = Modifier.fillMaxWidth()) { Text("Hướng dẫn và kiểm tra quyền") }
    }
}
