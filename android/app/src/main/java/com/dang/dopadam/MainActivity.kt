package com.dang.dopadam

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.dang.dopadam.ui.AppsScreen
import com.dang.dopadam.ui.ConfirmWeakeningDialog
import com.dang.dopadam.ui.GuideScreen
import com.dang.dopadam.ui.MainViewModel
import com.dang.dopadam.ui.OverviewScreen
import com.dang.dopadam.ui.SettingsScreen
import com.dang.dopadam.ui.theme.DopaTheme
import com.dang.dopadam.ui.theme.Tokens

private data class Tab(val route: String, val label: String, val icon: ImageVector)

@Suppress("DEPRECATION") // Icons.Filled.List is fine for a simple list glyph.
private val TABS = listOf(
    Tab(MainActivity.ROUTE_OVERVIEW, "Tổng quan", Icons.Filled.Home),
    Tab(MainActivity.ROUTE_APPS, "Ứng dụng", Icons.Filled.List),
    Tab(MainActivity.ROUTE_SETTINGS, "Cài đặt", Icons.Filled.Settings),
)

class MainActivity : ComponentActivity() {
    private val vm: MainViewModel by viewModels()
    private var requestedRoute by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)
        requestedRoute = intent?.getStringExtra(EXTRA_ROUTE)
        setContent { DopaTheme { App(vm, requestedRoute) { requestedRoute = null } } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        requestedRoute = intent.getStringExtra(EXTRA_ROUTE)
    }

    companion object {
        const val EXTRA_ROUTE = "route"
        const val ROUTE_OVERVIEW = "overview"
        const val ROUTE_APPS = "apps"
        const val ROUTE_SETTINGS = "settings"
        const val ROUTE_GUIDE = "guide"
    }
}

private fun NavHostController.goTab(route: String) = navigate(route) {
    popUpTo(MainActivity.ROUTE_OVERVIEW) { saveState = true }
    launchSingleTop = true
    restoreState = true
}

@Composable
private fun App(vm: MainViewModel, requestedRoute: String?, onRouteHandled: () -> Unit) {
    val nav = rememberNavController()
    val snackbar = remember { SnackbarHostState() }
    val message by vm.message.collectAsStateWithLifecycle()
    val pending by vm.pending.collectAsStateWithLifecycle()
    val backStack by nav.currentBackStackEntryAsState()
    val current = backStack?.destination?.route

    LaunchedEffect(requestedRoute) {
        if (requestedRoute != null) {
            nav.navigate(requestedRoute) { launchSingleTop = true }
            onRouteHandled()
        }
    }
    LaunchedEffect(message) {
        message?.let {
            snackbar.showSnackbar(it)
            vm.dismissMessage()
        }
    }

    Scaffold(
        containerColor = Tokens.Bg,
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = {
            NavigationBar(containerColor = Tokens.Surface) {
                for (tab in TABS) {
                    NavigationBarItem(
                        selected = current == tab.route,
                        onClick = { nav.goTab(tab.route) },
                        icon = { Icon(tab.icon, contentDescription = null) },
                        label = { Text(tab.label) },
                    )
                }
            }
        },
    ) { padding ->
        NavHost(nav, startDestination = MainActivity.ROUTE_OVERVIEW, modifier = Modifier.padding(padding)) {
            composable(MainActivity.ROUTE_OVERVIEW) {
                OverviewScreen(vm, openGuide = { nav.navigate(MainActivity.ROUTE_GUIDE) }, openApps = { nav.goTab(MainActivity.ROUTE_APPS) })
            }
            composable(MainActivity.ROUTE_APPS) { AppsScreen(vm) }
            composable(MainActivity.ROUTE_SETTINGS) { SettingsScreen(vm, openGuide = { nav.navigate(MainActivity.ROUTE_GUIDE) }) }
            composable(MainActivity.ROUTE_GUIDE) { GuideScreen() }
        }
    }

    pending?.let { p -> ConfirmWeakeningDialog(p.action, onConfirm = vm::confirmPending, onCancel = vm::cancelPending) }
}
