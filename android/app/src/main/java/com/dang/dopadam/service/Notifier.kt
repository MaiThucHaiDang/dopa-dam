package com.dang.dopadam.service

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.dang.dopadam.MainActivity
import com.dang.dopadam.R

object Notifier {
    private const val CHANNEL_GUARD = "guard"
    private const val CHANNEL_ALERTS = "alerts"
    const val ID_GUARD = 1
    private const val ID_HEADS_UP = 2
    private const val ID_TIMER = 3
    private const val ID_ACCESSIBILITY = 4
    private const val ID_NEW_APP_BASE = 1000

    fun createChannels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_GUARD, context.getString(R.string.channel_guard), NotificationManager.IMPORTANCE_MIN),
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ALERTS, context.getString(R.string.channel_alerts), NotificationManager.IMPORTANCE_HIGH),
        )
    }

    private fun openApp(context: Context, route: String? = null): PendingIntent {
        val intent = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .apply { if (route != null) putExtra(MainActivity.EXTRA_ROUTE, route) }
        return PendingIntent.getActivity(
            context,
            route?.hashCode() ?: 0,
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    private fun canPost(context: Context): Boolean =
        (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
            NotificationManagerCompat.from(context).areNotificationsEnabled()

    private fun post(context: Context, id: Int, notification: Notification) {
        if (!canPost(context)) return
        try {
            NotificationManagerCompat.from(context).notify(id, notification)
        } catch (e: SecurityException) {
            // Permission revoked between the check and the call; nothing else to do.
        }
    }

    fun guard(context: Context): Notification =
        NotificationCompat.Builder(context, CHANNEL_GUARD)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("DopaDam đang bảo vệ")
            .setContentText("Chạm để mở DopaDam")
            .setContentIntent(openApp(context))
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .build()

    fun headsUp(context: Context, appLabel: String) = post(
        context,
        ID_HEADS_UP,
        NotificationCompat.Builder(context, CHANNEL_ALERTS)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Còn 1 phút")
            .setContentText("Khoảng được phép cho $appLabel sắp hết. Hết giờ sẽ hiện lại màn hình cảnh báo.")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setTimeoutAfter(70_000)
            .setAutoCancel(true)
            .build(),
    )

    fun timerRunning(context: Context, activity: String, endsAt: Long) = post(
        context,
        ID_TIMER,
        NotificationCompat.Builder(context, CHANNEL_GUARD)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(activity)
            .setContentText("Đang làm việc khác thay vì vào app giải trí")
            .setWhen(endsAt)
            .setShowWhen(true)
            .setUsesChronometer(true)
            .setChronometerCountDown(true)
            .setOngoing(true)
            .build(),
    )

    fun timerDone(context: Context, activity: String, minutes: Int, studyLabel: String?) = post(
        context,
        ID_TIMER,
        NotificationCompat.Builder(context, CHANNEL_ALERTS)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Xong $minutes phút ${activity.lowercase()}")
            .setContentText(if (studyLabel != null) "Quay lại \"$studyLabel\" nhé." else "Quay lại việc đang làm nhé.")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .build(),
    )

    fun newApp(context: Context, pkg: String, label: String) = post(
        context,
        ID_NEW_APP_BASE + (pkg.hashCode() and 0xFFF),
        NotificationCompat.Builder(context, CHANNEL_ALERTS)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Vừa cài $label")
            .setContentText("Gán tag cho app này để DopaDam biết có cần cảnh báo không.")
            .setContentIntent(openApp(context, MainActivity.ROUTE_APPS))
            .setAutoCancel(true)
            .build(),
    )

    fun accessibilityLost(context: Context) = post(
        context,
        ID_ACCESSIBILITY,
        NotificationCompat.Builder(context, CHANNEL_ALERTS)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("DopaDam đã mất quyền Trợ năng")
            .setContentText("Điện thoại đang không được bảo vệ. Chạm để bật lại.")
            .setContentIntent(openApp(context, MainActivity.ROUTE_GUIDE))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .build(),
    )

    fun cancelAccessibilityLost(context: Context) = NotificationManagerCompat.from(context).cancel(ID_ACCESSIBILITY)
}
