// FR08 on the phone: the same three charts as the agent, per day (14) or week (4), all devices merged.
package com.dang.dopadam.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.dang.dopadam.DopaDamApp
import com.dang.dopadam.data.DayStat
import com.dang.dopadam.ui.theme.Tokens
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.pow

/** Categorical slots validated against the dark surface (same as the agent's --dd-series-N). */
object ChartColors {
    val Series1 = Color(0xFF3987E5)
    val Series2 = Color(0xFFD95926)
    val Series3 = Color(0xFF199E70)
    val Series4 = Color(0xFFC98500)
    val Series5 = Color(0xFFD55181)
}

data class ChartSeries(val label: String, val color: Color)

private data class Bucket(val label: String, val days: List<DayStat>)

private fun shortDay(day: String): String {
    val parts = day.split("-")
    return "${parts[2].toInt()}/${parts[1].toInt()}"
}

private fun niceMax(v: Double): Double {
    if (v <= 0) return 1.0
    val p = 10.0.pow(floor(log10(v)))
    return listOf(1.0, 2.0, 2.5, 5.0, 10.0).map { it * p }.first { it >= v }
}

@Composable
fun StatsScreen() {
    val app = LocalContext.current.applicationContext as DopaDamApp
    var stats by remember { mutableStateOf<List<DayStat>?>(null) }
    var budget by remember { mutableStateOf(0) }
    var weeks by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        val now = System.currentTimeMillis()
        stats = app.repository.stats(now, 28)
        budget = app.repository.settings().budgetMinutes
    }
    val all = stats ?: return
    val buckets = if (weeks) {
        all.chunked(7).map { Bucket("${shortDay(it.first().day)}–${shortDay(it.last().day)}", it) }
    } else {
        all.takeLast(14).map { Bucket(shortDay(it.day), listOf(it)) }
    }
    val labels = buckets.map { it.label }
    fun sum(b: Bucket, f: (DayStat) -> Double) = b.days.sumOf(f)

    Column(
        Modifier
            .verticalScroll(rememberScrollState())
            .padding(Tokens.SpaceMd),
        verticalArrangement = Arrangement.spacedBy(Tokens.SpaceMd),
    ) {
        Text("Thống kê", style = MaterialTheme.typography.headlineSmall)
        Muted("Gộp mọi thiết bị đã đồng bộ. Mục tiêu: tỉ lệ Thoát tăng dần, số giây đến lúc Thoát giảm dần.")
        Row(horizontalArrangement = Arrangement.spacedBy(Tokens.SpaceSm)) {
            FilterChip(selected = !weeks, onClick = { weeks = false }, label = { Text("14 ngày") })
            FilterChip(selected = weeks, onClick = { weeks = true }, label = { Text("4 tuần") })
        }
        BarChartCard(
            "Lần bị chặn và lựa chọn",
            labels,
            listOf(ChartSeries("Thoát", ChartColors.Series1), ChartSeries("Vào", ChartColors.Series2), ChartSeries("Làm việc khác", ChartColors.Series3)),
            listOf(
                buckets.map { b -> sum(b) { it.exit.toDouble() } },
                buckets.map { b -> sum(b) { it.enter.toDouble() } },
                buckets.map { b -> sum(b) { it.alternative.toDouble() } },
            ),
            unit = "lần",
        )
        BarChartCard(
            "Số giây trung bình đến lúc bấm Thoát",
            labels,
            listOf(ChartSeries("Giây đến Thoát", ChartColors.Series1)),
            listOf(buckets.map { b -> val n = sum(b) { it.exitCount.toDouble() }; if (n > 0) sum(b) { it.exitSecondsSum } / n else 0.0 }),
            unit = "giây",
            decimals = true,
        )
        val groups = listOf(
            ChartSeries("Giải trí", ChartColors.Series1) to listOf("entertainment"),
            ChartSeries("Game", ChartColors.Series2) to listOf("game"),
            ChartSeries("Học tập", ChartColors.Series3) to listOf("study"),
            ChartSeries("Công việc", ChartColors.Series4) to listOf("work"),
            ChartSeries("Khác", ChartColors.Series5) to listOf("communication", "utility"),
        )
        BarChartCard(
            "Thời gian dùng theo tag",
            labels,
            groups.map { it.first },
            groups.map { (_, tags) -> buckets.map { b -> sum(b) { d -> tags.sumOf { d.minutes[it] ?: 0.0 } } } },
            unit = "phút",
            reference = if (!weeks && budget > 0) budget.toDouble() to "Ngân sách $budget phút (Giải trí + Game)" else null,
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun BarChartCard(
    title: String,
    labels: List<String>,
    series: List<ChartSeries>,
    values: List<List<Double>>,
    unit: String,
    decimals: Boolean = false,
    reference: Pair<Double, String>? = null,
) {
    var selected by remember(labels) { mutableStateOf<Int?>(null) }
    var asTable by remember { mutableStateOf(false) }
    fun fmt(v: Double) = if (decimals && v < 10) "%.1f".format(v) else v.toInt().toString()
    val totals = labels.indices.map { c -> series.indices.sumOf { values[it][c] } }
    val max = niceMax(maxOf(totals.maxOrNull() ?: 0.0, reference?.first ?: 0.0))
    val density = LocalDensity.current

    SectionCard(title) {
        if (series.size > 1) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Tokens.SpaceMd)) {
                for (s in series) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(10.dp).background(s.color, MaterialTheme.shapes.extraSmall))
                        Text(" ${s.label}", style = MaterialTheme.typography.bodySmall, color = Tokens.TextMuted)
                    }
                }
            }
        }
        if (asTable) {
            labels.forEachIndexed { c, label ->
                Text("$label: " + series.indices.joinToString(" · ") { "${series[it].label} ${fmt(values[it][c])} $unit" }, style = MaterialTheme.typography.bodySmall)
            }
        } else if (totals.all { it <= 0 }) {
            Muted("Chưa có số liệu.")
        } else {
            val description = "$title: " + labels.indices.joinToString("; ") { c -> "${labels[c]} ${fmt(totals[c])} $unit" }
            Canvas(
                Modifier
                    .fillMaxWidth()
                    .height(180.dp)
                    .semantics { contentDescription = description }
                    .pointerInput(labels) {
                        detectTapGestures { pos -> selected = (pos.x / (size.width / labels.size)).toInt().coerceIn(0, labels.size - 1) }
                    },
            ) {
                val bottomPad = with(density) { 4.dp.toPx() }
                val plotH = size.height - bottomPad
                val band = size.width / labels.size
                val barW = minOf(band * 0.6f, with(density) { 22.dp.toPx() })
                val gap = with(density) { 2.dp.toPx() }
                val radius = with(density) { 4.dp.toPx() }
                fun y(v: Double) = (plotH - (v / max) * plotH).toFloat()
                for (t in listOf(0.0, max / 2, max)) {
                    drawLine(Tokens.Border, Offset(0f, y(t)), Offset(size.width, y(t)), strokeWidth = 1f)
                }
                for (c in labels.indices) {
                    val x = band * c + (band - barW) / 2
                    var base = 0.0
                    val parts = series.indices.map { it to values[it][c] }.filter { it.second > 0 }
                    parts.forEachIndexed { i, (s, v) ->
                        val top = y(base + v)
                        val bottom = y(base) - if (i > 0) gap else 0f
                        base += v
                        val h = (bottom - top).coerceAtLeast(1f)
                        if (i == parts.lastIndex) {
                            val path = Path().apply {
                                addRoundRect(
                                    RoundRect(
                                        left = x, top = top, right = x + barW, bottom = top + h,
                                        topLeftCornerRadius = CornerRadius(radius), topRightCornerRadius = CornerRadius(radius),
                                    ),
                                )
                            }
                            drawPath(path, series[s].color)
                        } else {
                            drawRect(series[s].color, Offset(x, top), Size(barW, h))
                        }
                    }
                    if (c == selected) {
                        drawLine(Tokens.TextFaint, Offset(band * c + band / 2, 0f), Offset(band * c + band / 2, plotH), strokeWidth = 1f)
                    }
                }
                reference?.let { (v, _) ->
                    drawLine(
                        Tokens.TextMuted, Offset(0f, y(v)), Offset(size.width, y(v)), strokeWidth = 3f,
                        pathEffect = PathEffect.dashPathEffect(floatArrayOf(14f, 10f)),
                    )
                }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Muted(labels.first())
                Muted("Tối đa ${fmt(max)} $unit")
                Muted(labels.last())
            }
            reference?.let { Muted("Đường gạch: ${it.second}") }
            val c = selected
            if (c != null) {
                Text(
                    "${labels[c]}: " + series.indices.joinToString(" · ") { "${series[it].label} ${fmt(values[it][c])} $unit" },
                    style = MaterialTheme.typography.bodySmall,
                )
            } else {
                Muted("Chạm vào một cột để xem số liệu.")
            }
        }
        TextButton(onClick = { asTable = !asTable }) { Text(if (asTable) "Xem biểu đồ" else "Xem dạng bảng") }
    }
}
