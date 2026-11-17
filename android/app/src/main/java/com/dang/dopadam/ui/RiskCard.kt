// "Giờ nguy cơ" card of the statistics screen (docs/thiet-ke-ky-thuat.md, 2.5): a heat map of when entertainment
// is opened, one suggestion, and the active windows. The wording lives in logic/RiskText.kt.
package com.dang.dopadam.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
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
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.dang.dopadam.DopaDamApp
import com.dang.dopadam.core.MAX_RISK_WINDOWS
import com.dang.dopadam.core.RiskHeatmap
import com.dang.dopadam.core.suggestRiskWindow
import com.dang.dopadam.logic.RISK_NO_SUGGESTION
import com.dang.dopadam.logic.RISK_ROW_LABELS
import com.dang.dopadam.logic.riskHeatmapDescription
import com.dang.dopadam.logic.riskIntensity
import com.dang.dopadam.logic.riskSuggestionText
import com.dang.dopadam.logic.riskWindowLine
import com.dang.dopadam.ui.theme.Tokens

private const val HEAT_DAYS = 28

/** Cell colour: one hue (the accent), more opaque the more opens; empty cells are the raised surface. */
private fun heatAlpha(intensity: Float) = 0.3f + 0.7f * intensity

@Composable
fun RiskHoursCard(vm: MainViewModel) {
    val app = LocalContext.current.applicationContext as DopaDamApp
    val settings by vm.settings.collectAsStateWithLifecycle()
    var heat by remember { mutableStateOf<RiskHeatmap?>(null) }
    LaunchedEffect(Unit) { heat = app.repository.riskHeatmap(System.currentTimeMillis(), HEAT_DAYS) }
    val windows = settings.riskWindows

    SectionCard("Giờ nguy cơ") {
        Muted("4 tuần gần nhất. Ô càng đậm, bạn càng hay mở giải trí vào giờ đó.")
        val cells = heat
        if (cells == null) {
            Muted("Đang tải.")
            return@SectionCard
        }
        HeatmapGrid(cells)
        HeatmapLegend()
        val suggestion = remember(cells, windows) { suggestRiskWindow(cells, windows) }
        if (suggestion != null) {
            Text(riskSuggestionText(suggestion), style = MaterialTheme.typography.bodyMedium)
            val full = windows.size >= MAX_RISK_WINDOWS
            Button(onClick = { vm.addRiskWindow(suggestion) }, enabled = !full) { Text("Tăng cản trở trong khung này") }
            if (full) Muted("Đã có tối đa $MAX_RISK_WINDOWS khung. Gỡ bớt một khung để thêm khung mới.")
        } else {
            Muted(RISK_NO_SUGGESTION)
        }
        for (w in windows) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(riskWindowLine(w), style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                TextButton(onClick = { vm.removeRiskWindow(w) }) { Text("Gỡ", color = Tokens.TextMuted) }
            }
        }
    }
}

/**
 * 7 rows (T2 ... CN) of 24 small squares, sized from the available width so it never scrolls sideways (about
 * 11 dp a cell on a 360 dp phone). The whole grid is one node for a screen reader, with the busiest cell in words.
 */
@Composable
private fun HeatmapGrid(cells: RiskHeatmap) {
    val maxOpens = cells.maxOfOrNull { row -> row.maxOfOrNull { it.opens } ?: 0 } ?: 0
    val description = remember(cells) { riskHeatmapDescription(cells) }
    BoxWithConstraints(Modifier.fillMaxWidth().clearAndSetSemantics { contentDescription = description }) {
        val labelWidth = 24.dp
        val cell = (maxWidth - labelWidth) / 24
        Column {
            Row {
                Column(Modifier.width(labelWidth)) {
                    for (label in RISK_ROW_LABELS) {
                        Box(Modifier.width(labelWidth).height(cell), contentAlignment = Alignment.CenterStart) {
                            Text(label, color = Tokens.TextMuted, fontSize = 10.sp, lineHeight = 10.sp, maxLines = 1, softWrap = false, overflow = TextOverflow.Visible)
                        }
                    }
                }
                Canvas(Modifier.size(cell * 24, cell * 7)) {
                    val step = size.width / 24
                    val gap = 1.dp.toPx()
                    val radius = CornerRadius(2.dp.toPx())
                    for (r in 0 until 7) {
                        for (h in 0 until 24) {
                            val opens = cells.getOrNull(r)?.getOrNull(h)?.opens ?: 0
                            val color = if (opens <= 0) Tokens.SurfaceRaised else Tokens.Accent.copy(alpha = heatAlpha(riskIntensity(opens, maxOpens)))
                            drawRoundRect(
                                color,
                                Offset(h * step + gap / 2, r * step + gap / 2),
                                Size(step - gap, step - gap),
                                radius,
                            )
                        }
                    }
                }
            }
            Box(Modifier.padding(start = labelWidth).fillMaxWidth().height(14.dp)) {
                for (h in listOf(0, 6, 12, 18)) {
                    Text("${h}h", color = Tokens.TextMuted, fontSize = 10.sp, lineHeight = 10.sp, maxLines = 1, softWrap = false, modifier = Modifier.offset(x = cell * h))
                }
            }
        }
    }
}

/** "Ít [4 squares] Nhiều": the same hue at four strengths. */
@Composable
private fun HeatmapLegend() {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Muted("Ít")
        for (i in listOf(0.0f, 0.34f, 0.67f, 1f)) {
            Box(Modifier.size(10.dp).background(Tokens.Accent.copy(alpha = heatAlpha(i)), MaterialTheme.shapes.extraSmall))
        }
        Muted("Nhiều")
    }
}
