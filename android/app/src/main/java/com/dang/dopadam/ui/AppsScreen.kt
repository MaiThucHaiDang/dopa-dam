package com.dang.dopadam.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
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
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.graphics.drawable.toBitmap
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.dang.dopadam.core.Tag
import com.dang.dopadam.core.effectiveDelay
import com.dang.dopadam.data.TagRuleEntity
import com.dang.dopadam.service.InstalledApp
import com.dang.dopadam.service.InstalledApps
import com.dang.dopadam.ui.theme.Tokens
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@Composable
fun AppsScreen(vm: MainViewModel) {
    val apps by vm.apps.collectAsStateWithLifecycle()
    val rules by vm.rules.collectAsStateWithLifecycle()
    val settings by vm.settings.collectAsStateWithLifecycle()
    var query by remember { mutableStateOf("") }
    var editing by remember { mutableStateOf<InstalledApp?>(null) }

    Column(Modifier.padding(horizontal = Tokens.SpaceMd)) {
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            placeholder = { Text("Tìm app") },
            singleLine = true,
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = Tokens.SpaceSm),
        )
        val list = apps
        if (list == null) {
            Muted("Đang tải danh sách app…")
            return@Column
        }
        val filtered = list.filter { query.isBlank() || it.label.contains(query.trim(), ignoreCase = true) }
        val (tagged, untagged) = filtered.partition { rules.containsKey(it.pkg) }
        LazyColumn {
            if (untagged.isNotEmpty()) {
                item { SectionHeader("Chưa gán tag (${untagged.size})") }
                items(untagged, key = { "u:" + it.pkg }) { app -> AppRow(app, null, null) { editing = app } }
            }
            if (tagged.isNotEmpty()) {
                item { SectionHeader("Đã gán tag (${tagged.size})") }
                items(tagged, key = { "t:" + it.pkg }) { app ->
                    val rule = rules[app.pkg]
                    val delay = rule?.let { effectiveDelay(it.delaySeconds, it.tag, settings.tagDelays) }
                    AppRow(app, rule, delay) { editing = app }
                }
            }
        }
    }

    editing?.let { app ->
        TagDialog(
            app = app,
            rule = rules[app.pkg],
            defaultDelay = rules[app.pkg]?.let { settings.tagDelays[it.tag] } ?: 0,
            onTag = { tag ->
                vm.setTag(app, tag)
                editing = null
            },
            onDelay = { seconds -> vm.setDelay(app, seconds) },
            onDismiss = { editing = null },
        )
    }
}

@Composable
private fun SectionHeader(text: String) {
    Text(
        text,
        color = Tokens.TextMuted,
        style = MaterialTheme.typography.bodySmall,
        modifier = Modifier.padding(top = Tokens.SpaceMd, bottom = Tokens.SpaceXs),
    )
}

@Composable
private fun AppIcon(pkg: String) {
    val context = LocalContext.current
    var bitmap by remember(pkg) { mutableStateOf<ImageBitmap?>(null) }
    LaunchedEffect(pkg) {
        bitmap = withContext(Dispatchers.IO) {
            InstalledApps.icon(context, pkg)?.toBitmap(96, 96)?.asImageBitmap()
        }
    }
    Box(Modifier.size(40.dp)) {
        bitmap?.let { Image(it, contentDescription = null, modifier = Modifier.size(40.dp)) }
    }
}

@Composable
private fun AppRow(app: InstalledApp, rule: TagRuleEntity?, delay: Int?, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = Tokens.SpaceSm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AppIcon(app.pkg)
        Spacer(Modifier.width(Tokens.SpaceMd))
        Column(Modifier.weight(1f)) {
            Text(app.label, style = MaterialTheme.typography.bodyLarge)
            if (app.isGame && rule == null) Muted("Có vẻ là game")
        }
        val tag = Tag.fromId(rule?.tag)
        if (tag != null) {
            val text = if (tag.blocked && (delay ?: 0) > 0) "${tag.label} · trễ ${delay}s" else tag.label
            Text(
                text,
                style = MaterialTheme.typography.bodySmall,
                color = if (tag.blocked) Tokens.Text else Tokens.TextMuted,
                modifier = Modifier
                    .background(if (tag.blocked) Tokens.AccentSoft else Tokens.SurfaceRaised, MaterialTheme.shapes.small)
                    .padding(horizontal = 10.dp, vertical = 4.dp),
            )
        } else {
            Muted("Gán tag")
        }
    }
    HorizontalDivider(color = Tokens.Border)
}

@Composable
private fun TagDialog(
    app: InstalledApp,
    rule: TagRuleEntity?,
    defaultDelay: Int,
    onTag: (Tag?) -> Unit,
    onDelay: (Int?) -> Unit,
    onDismiss: () -> Unit,
) {
    var selected by remember { mutableStateOf(Tag.fromId(rule?.tag)) }
    var delayText by remember { mutableStateOf(rule?.delaySeconds?.toString() ?: "") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(app.label) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                for (tag in Tag.entries) {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .selectable(selected = selected == tag, role = Role.RadioButton) { selected = tag },
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = selected == tag, onClick = null)
                        Spacer(Modifier.width(Tokens.SpaceSm))
                        Text(tag.label)
                    }
                }
                if (rule != null && Tag.fromId(rule.tag)?.blocked == true) {
                    Spacer(Modifier.size(Tokens.SpaceSm))
                    Muted("Độ trễ cảnh báo riêng cho app này (giây, để trống = theo tag: ${defaultDelay}s)")
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        OutlinedTextField(
                            value = delayText,
                            onValueChange = { delayText = it.filter(Char::isDigit).take(3) },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            modifier = Modifier.width(110.dp),
                        )
                        TextButton(onClick = { onDelay(delayText.toIntOrNull()) }) { Text("Lưu độ trễ") }
                    }
                }
            }
        },
        confirmButton = {
            Button(onClick = { onTag(selected) }, enabled = selected?.id != rule?.tag) { Text("Lưu tag") }
        },
        dismissButton = {
            Row {
                if (rule != null) TextButton(onClick = { onTag(null) }) { Text("Bỏ tag") }
                TextButton(onClick = onDismiss) { Text("Đóng") }
            }
        },
        containerColor = Tokens.Surface,
    )
}
