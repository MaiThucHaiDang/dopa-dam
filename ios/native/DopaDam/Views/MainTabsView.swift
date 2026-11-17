import SwiftUI

struct MainTabsView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        TabView(selection: tabBinding) {
            OverviewView()
                .tabItem { Label("Tổng quan", systemImage: "house") }
                .tag(AppTab.overview)
            StudyView()
                .tabItem { Label("Học", systemImage: "book") }
                .tag(AppTab.study)
            StatsView()
                .tabItem { Label("Thống kê", systemImage: "chart.bar") }
                .tag(AppTab.stats)
            SettingsView()
                .tabItem { Label("Cài đặt", systemImage: "gearshape") }
                .tag(AppTab.settings)
            GuideView()
                .tabItem { Label("Hướng dẫn", systemImage: "questionmark.circle") }
                .tag(AppTab.guide)
        }
    }

    private var tabBinding: Binding<AppTab> {
        Binding(
            get: { model.selectedTab },
            set: { model.selectedTab = $0 })
    }
}
