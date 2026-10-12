package com.dang.dopadam.ui

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import com.dang.dopadam.DopaDamApp
import com.dang.dopadam.service.Permissions
import com.dang.dopadam.ui.theme.Tokens

private fun Context.tryStart(vararg intents: Intent): Boolean {
    for (intent in intents) {
        try {
            startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            return true
        } catch (e: ActivityNotFoundException) {
            continue
        } catch (e: SecurityException) {
            continue
        }
    }
    return false
}

@Composable
private fun CheckRow(title: String, ok: Boolean, detail: String, fix: (() -> Unit)?) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Tokens.SpaceXs)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(title, modifier = Modifier.weight(1f))
            Text(if (ok) "Đạt" else "Thiếu", color = if (ok) Tokens.Accent else Tokens.Text)
        }
        Muted(detail)
        if (!ok && fix != null) OutlinedButton(onClick = fix) { Text("Sửa") }
    }
}

@Composable
private fun ManualStep(key: String, title: String, detail: String, open: (() -> Unit)?) {
    val prefs = (LocalContext.current.applicationContext as DopaDamApp).repository.prefs
    var done by remember { mutableStateOf(prefs.manualStepDone(key)) }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Tokens.SpaceXs)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = done, onCheckedChange = {
                done = it
                prefs.setManualStepDone(key, it)
            })
            Text(title, modifier = Modifier.weight(1f))
        }
        Muted(detail)
        if (open != null) OutlinedButton(onClick = open) { Text("Mở cài đặt") }
    }
}

/** FR13 and spec section 7: permission checklist, Xiaomi steps and how the app works. */
@Composable
fun GuideScreen() {
    val context = LocalContext.current
    var resumes by remember { mutableIntStateOf(0) }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { resumes++ }
    val accessibility = remember(resumes) { Permissions.accessibilityEnabled(context) }
    val notifications = remember(resumes) { Permissions.notificationsAllowed(context) }
    val battery = remember(resumes) { Permissions.batteryUnrestricted(context) }
    val notificationRequest = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { resumes++ }

    Column(
        Modifier
            .verticalScroll(rememberScrollState())
            .padding(Tokens.SpaceMd),
        verticalArrangement = Arrangement.spacedBy(Tokens.SpaceMd),
    ) {
        Text("Hướng dẫn", style = MaterialTheme.typography.headlineSmall)

        SectionCard("Kiểm tra tình trạng") {
            CheckRow(
                "Quyền Trợ năng",
                accessibility,
                "Cài đặt → Trợ năng → Ứng dụng đã tải xuống → DopaDam bảo vệ → Bật. DopaDam chỉ biết app nào vừa mở, không đọc nội dung màn hình.",
            ) { context.tryStart(Permissions.accessibilitySettings()) }
            CheckRow("Thông báo", notifications, "Để nhắc \"Còn 1 phút\", báo hết giờ nghỉ và báo khi mất quyền Trợ năng.") {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    notificationRequest.launch(Manifest.permission.POST_NOTIFICATIONS)
                } else {
                    context.tryStart(Permissions.notificationSettings(context))
                }
            }
            CheckRow("Chạy nền không giới hạn pin", battery, "Để hệ thống không tắt DopaDam khi tiết kiệm pin.") {
                context.tryStart(Permissions.batteryExemption(context), Permissions.appDetails(context))
            }
        }

        if (Permissions.mayNeedRestrictedSettings()) {
            SectionCard("Nếu không bật được Trợ năng") {
                Muted(
                    "Android 13 trở lên chặn quyền Trợ năng với app cài ngoài cửa hàng. Mở Thông tin ứng dụng → bấm menu ba chấm ở góc trên → " +
                        "\"Cho phép cài đặt hạn chế\" (Allow restricted settings), rồi quay lại bật Trợ năng.",
                )
                OutlinedButton(onClick = { context.tryStart(Permissions.appDetails(context)) }) { Text("Mở Thông tin ứng dụng") }
            }
        }

        SectionCard(if (Permissions.isXiaomi()) "Các bước riêng cho Xiaomi (máy của bạn)" else "Các bước riêng cho Xiaomi / Redmi / POCO") {
            Muted("HyperOS và MIUI hay tắt app chạy nền, kéo theo mất quyền Trợ năng. Làm đủ ba bước rồi đánh dấu.")
            ManualStep(
                "xiaomi-autostart",
                "Bật Tự khởi động (Autostart)",
                "Bảo mật → Ứng dụng → Quyền → Tự khởi động → bật DopaDam.",
            ) { context.tryStart(Permissions.xiaomiAutostart(), Permissions.appDetails(context)) }
            ManualStep(
                "xiaomi-battery",
                "Tiết kiệm pin: Không giới hạn",
                "Thông tin ứng dụng → Tiết kiệm pin → Không giới hạn.",
            ) { context.tryStart(Permissions.appDetails(context)) }
            ManualStep(
                "xiaomi-lock",
                "Khóa DopaDam trong đa nhiệm",
                "Mở màn hình đa nhiệm, nhấn giữ thẻ DopaDam và chọn biểu tượng ổ khóa.",
                null,
            )
        }

        SectionCard("App hoạt động thế nào") {
            Muted(
                "Mở app gắn tag Giải trí hoặc Game thì hiện câu hỏi \"Bạn mở … để làm gì?\". Thoát luôn bấm được ngay (nút quay lại cũng là Thoát). " +
                    "Nút Vào khóa vài giây: 5 giây lần đầu trong giờ, 10 giây lần thứ 2–3, 20 giây từ lần thứ 4, và 30 giây khi đang học hoặc đã dùng hết ngân sách giải trí trong ngày.",
            )
            Muted("Chọn Vào thì được dùng app trong 5, 15 hoặc 30 phút (đang học: 5 hoặc 10). Còn 1 phút sẽ có thông báo, hết giờ thì hỏi lại.")
            Muted("Game có độ trễ: cảnh báo chỉ hiện sau khi game đã mở đủ số giây cài đặt, để không bị màn hình tải của game che mất.")
            Muted("\"Làm việc khác\" chọn nhảy dây, hít đất hoặc đọc sách trong 2–10 phút, hết giờ có thông báo nhắc quay lại việc đang làm.")
            Muted("Giảm bảo vệ (bỏ tag Giải trí, giảm thời gian khóa, tắt bảo vệ…) phải chờ 60 giây rồi gõ \"tôi chọn giảm bảo vệ\".")
        }
    }
}
