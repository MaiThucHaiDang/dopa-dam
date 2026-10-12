package com.dang.dopadam.ui.warning

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.unit.dp
import com.dang.dopadam.ui.theme.Tokens
import kotlinx.coroutines.delay

data class WarningUiState(
    val appLabel: String,
    val countThisHour: Int,
    val lockSeconds: Int,
    val allowOptions: List<Int>,
    val usedMinutes: Double,
    val budgetMinutes: Int,
    val studyLabel: String?,
    val studyMinutesLeft: Int?,
    val activities: List<String>,
    val error: String? = null,
)

interface WarningActions {
    fun exit()
    fun enter(minutes: Int)
    fun alternative(activity: String, minutes: Int)
}

private enum class Step { CHOICE, ALTERNATIVE }

/** Full-screen warning. Thoát is big and always available; Vào is small, locked, and touch only. */
@Composable
fun WarningScreen(state: WarningUiState?, actions: WarningActions) {
    Column(
        Modifier
            .fillMaxSize()
            .background(Tokens.Bg)
            .safeDrawingPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = Tokens.SpaceLg, vertical = Tokens.SpaceXl),
        verticalArrangement = Arrangement.spacedBy(Tokens.SpaceLg),
    ) {
        if (state == null) return@Column
        var step by remember { mutableStateOf(Step.CHOICE) }
        Spacer(Modifier.height(Tokens.SpaceLg))
        Text(
            "Lần thứ ${state.countThisHour} trong 60 phút qua · nút Vào khóa ${state.lockSeconds} giây",
            color = Tokens.TextMuted,
            style = MaterialTheme.typography.bodySmall,
        )
        when (step) {
            Step.CHOICE -> Choice(state, actions) { step = Step.ALTERNATIVE }
            Step.ALTERNATIVE -> Alternative(state, actions) { step = Step.CHOICE }
        }
        state.error?.let { Text(it, color = Tokens.Accent) }
        HorizontalDivider(color = Tokens.Border)
        val used = state.usedMinutes.toInt()
        Text(
            if (state.budgetMinutes > 0) "Hôm nay: $used / ${state.budgetMinutes} phút giải trí" else "Hôm nay: $used phút giải trí",
            color = Tokens.TextMuted,
            style = MaterialTheme.typography.bodySmall,
        )
        if (state.studyLabel != null) {
            Text(
                "Đang học: ${state.studyLabel}" + (state.studyMinutesLeft?.let { " · còn $it phút" } ?: ""),
                color = Tokens.Text,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier
                    .background(Tokens.AccentSoft, MaterialTheme.shapes.small)
                    .padding(horizontal = 10.dp, vertical = 4.dp),
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Choice(state: WarningUiState, actions: WarningActions, onAlternative: () -> Unit) {
    var remaining by remember { mutableIntStateOf(state.lockSeconds) }
    var showOptions by remember { mutableStateOf(false) }
    LaunchedEffect(state.lockSeconds) {
        while (remaining > 0) {
            delay(1000)
            remaining--
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.SpaceLg)) {
        Text("Bạn mở ${state.appLabel} để làm gì?", style = MaterialTheme.typography.displaySmall)
        Text("Dành vài giây trả lời câu hỏi này trong đầu.", color = Tokens.TextMuted, style = MaterialTheme.typography.titleMedium)
        Button(
            onClick = actions::exit,
            modifier = Modifier.fillMaxWidth().height(72.dp),
            shape = MaterialTheme.shapes.large,
        ) {
            Text("Thoát", style = MaterialTheme.typography.headlineSmall)
        }
        Text("Nút quay lại cũng là Thoát", color = Tokens.TextFaint, style = MaterialTheme.typography.bodySmall)
        TextButton(onClick = onAlternative) { Text("Làm việc khác thay vì vào") }
        Spacer(Modifier.height(Tokens.SpaceSm))
        // Keyboard focus can never reach Vào: only a touch opens it.
        OutlinedButton(
            onClick = { if (remaining <= 0) showOptions = true },
            enabled = remaining <= 0,
            modifier = Modifier.focusProperties { canFocus = false },
        ) {
            Text(if (remaining > 0) "Vào ($remaining)" else "Vào", style = MaterialTheme.typography.bodySmall)
        }
        if (showOptions) {
            Text("Vào trong bao lâu?", color = Tokens.TextFaint, style = MaterialTheme.typography.bodySmall)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Tokens.SpaceSm)) {
                for (minutes in state.allowOptions) {
                    OutlinedButton(
                        onClick = { actions.enter(minutes) },
                        modifier = Modifier.focusProperties { canFocus = false },
                    ) {
                        Text("$minutes phút", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Alternative(state: WarningUiState, actions: WarningActions, onBack: () -> Unit) {
    var activity by remember { mutableStateOf<String?>(null) }
    var minutes by remember { mutableIntStateOf(5) }
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.SpaceLg)) {
        Text("Làm gì thay vào đó?", style = MaterialTheme.typography.displaySmall)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Tokens.SpaceSm), verticalArrangement = Arrangement.spacedBy(Tokens.SpaceSm)) {
            for (name in state.activities) {
                if (name == activity) {
                    Button(onClick = { activity = name }) { Text(name) }
                } else {
                    OutlinedButton(onClick = { activity = name }) { Text(name) }
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Tokens.SpaceSm)) {
            OutlinedButton(onClick = { if (minutes > 2) minutes-- }) { Text("−") }
            Text("$minutes phút", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 10.dp))
            OutlinedButton(onClick = { if (minutes < 10) minutes++ }) { Text("+") }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Tokens.SpaceSm)) {
            Button(onClick = { activity?.let { actions.alternative(it, minutes) } }, enabled = activity != null) {
                Text("Bắt đầu")
            }
            OutlinedButton(onClick = onBack) { Text("Quay lại") }
        }
    }
}
