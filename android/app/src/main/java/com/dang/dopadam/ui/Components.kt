package com.dang.dopadam.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.unit.dp
import com.dang.dopadam.core.CONFIRM_PHRASE
import com.dang.dopadam.core.CONFIRM_WAIT_SECONDS
import com.dang.dopadam.core.isConfirmPhrase
import com.dang.dopadam.ui.theme.Tokens
import kotlinx.coroutines.delay

@Composable
fun SectionCard(title: String, modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier
            .fillMaxWidth()
            .background(Tokens.Surface, MaterialTheme.shapes.large)
            .border(1.dp, Tokens.Border, MaterialTheme.shapes.large)
            .padding(Tokens.SpaceMd),
        verticalArrangement = Arrangement.spacedBy(Tokens.SpaceSm),
    ) {
        Text(title, style = MaterialTheme.typography.titleMedium)
        content()
    }
}

@Composable
fun Muted(text: String, modifier: Modifier = Modifier) {
    Text(text, color = Tokens.TextMuted, style = MaterialTheme.typography.bodySmall, modifier = modifier)
}

/** FR14: wait 60 seconds, then type the sentence, before a change that weakens protection goes through. */
@Composable
fun ConfirmWeakeningDialog(action: String, onConfirm: () -> Unit, onCancel: () -> Unit) {
    var remaining by remember { mutableIntStateOf(CONFIRM_WAIT_SECONDS) }
    var typed by remember { mutableStateOf("") }
    LaunchedEffect(Unit) {
        while (remaining > 0) {
            delay(1000)
            remaining--
        }
    }
    AlertDialog(
        onDismissRequest = onCancel,
        title = { Text("Thay đổi này làm yếu bảo vệ") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Tokens.SpaceSm)) {
                Text(action)
                Muted(if (remaining > 0) "Chờ $remaining giây rồi mới gõ được câu xác nhận." else "Bây giờ có thể gõ câu xác nhận.")
                Muted("Gõ chính xác: $CONFIRM_PHRASE")
                OutlinedTextField(
                    value = typed,
                    onValueChange = { typed = it },
                    enabled = remaining <= 0,
                    singleLine = true,
                    placeholder = { Text(CONFIRM_PHRASE) },
                )
            }
        },
        confirmButton = {
            Button(onClick = onCancel) { Text("Giữ nguyên bảo vệ") }
        },
        dismissButton = {
            TextButton(onClick = onConfirm, enabled = remaining <= 0 && isConfirmPhrase(typed)) { Text("Xác nhận") }
        },
        containerColor = Tokens.Surface,
    )
}
