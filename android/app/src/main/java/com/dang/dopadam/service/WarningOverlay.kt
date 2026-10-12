package com.dang.dopadam.service

import android.accessibilityservice.AccessibilityService
import android.graphics.PixelFormat
import android.os.Build
import android.view.KeyEvent
import android.view.WindowManager
import android.widget.FrameLayout
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.platform.ComposeView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.lifecycle.setViewTreeViewModelStoreOwner
import androidx.savedstate.SavedStateRegistry
import androidx.savedstate.SavedStateRegistryController
import androidx.savedstate.SavedStateRegistryOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner
import com.dang.dopadam.ui.theme.DopaTheme
import com.dang.dopadam.ui.warning.WarningActions
import com.dang.dopadam.ui.warning.WarningScreen
import com.dang.dopadam.ui.warning.WarningUiState

/** Lifecycle for a Compose view living in a window that has no Activity. One per overlay. */
private class OverlayOwner : LifecycleOwner, SavedStateRegistryOwner, ViewModelStoreOwner {
    private val registry = LifecycleRegistry(this)
    private val savedState = SavedStateRegistryController.create(this)
    override val lifecycle: Lifecycle get() = registry
    override val savedStateRegistry: SavedStateRegistry get() = savedState.savedStateRegistry
    override val viewModelStore = ViewModelStore()

    fun start() {
        savedState.performRestore(null)
        registry.currentState = Lifecycle.State.RESUMED
    }

    fun destroy() {
        registry.currentState = Lifecycle.State.DESTROYED
        viewModelStore.clear()
    }
}

/**
 * The warning drawn as an accessibility overlay: it appears above the app immediately and needs no
 * "draw over other apps" permission. Back, Enter and Esc all mean Thoát.
 */
class WarningOverlay(private val service: AccessibilityService, private val actions: WarningActions) {
    private val windowManager = service.getSystemService(WindowManager::class.java)
    private val owner = OverlayOwner()
    private val state = mutableStateOf<WarningUiState?>(null)
    private var root: FrameLayout? = null

    fun show() {
        if (root != null) return
        val compose = ComposeView(service).apply {
            setContent { DopaTheme { WarningScreen(state.value, actions) } }
        }
        val frame = object : FrameLayout(service) {
            override fun dispatchKeyEvent(event: KeyEvent): Boolean {
                if (event.keyCode in EXIT_KEYS) {
                    if (event.action == KeyEvent.ACTION_UP) actions.exit()
                    return true
                }
                return super.dispatchKeyEvent(event)
            }
        }
        frame.addView(compose)
        frame.setViewTreeLifecycleOwner(owner)
        frame.setViewTreeSavedStateRegistryOwner(owner)
        frame.setViewTreeViewModelStoreOwner(owner)
        owner.start()
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.OPAQUE,
        ).apply {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                fitInsetsTypes = 0
            } else {
                @Suppress("DEPRECATION")
                flags = flags or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }
        windowManager.addView(frame, params)
        root = frame
    }

    fun update(newState: WarningUiState) {
        state.value = newState
    }

    fun current(): WarningUiState? = state.value

    fun dismiss() {
        root?.let { runCatching { windowManager.removeView(it) } }
        root = null
        owner.destroy()
    }

    private companion object {
        val EXIT_KEYS = setOf(KeyEvent.KEYCODE_BACK, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER, KeyEvent.KEYCODE_ESCAPE)
    }
}
