import Foundation
import UIKit
import Observation

extension View {
    // MARK: Text and colour
    public func font(_ font: Font?) -> some View { _ModifiedView(self) }
    public func foregroundColor(_ color: Color?) -> some View { _ModifiedView(self) }
    public func tint(_ tint: Color?) -> some View { _ModifiedView(self) }
    public func tint<S: ShapeStyle>(_ tint: S?) -> some View { _ModifiedView(self) }
    public func opacity(_ opacity: Double) -> some View { _ModifiedView(self) }
    public func multilineTextAlignment(_ alignment: TextAlignment) -> some View { _ModifiedView(self) }
    public func lineLimit(_ number: Int?) -> some View { _ModifiedView(self) }
    public func minimumScaleFactor(_ factor: CGFloat) -> some View { _ModifiedView(self) }
    public func fixedSize(horizontal: Bool, vertical: Bool) -> some View { _ModifiedView(self) }
    public func preferredColorScheme(_ colorScheme: ColorScheme?) -> some View { _ModifiedView(self) }

    // MARK: Layout
    public func frame(width: CGFloat? = nil, height: CGFloat? = nil, alignment: Alignment = .center) -> some View { _ModifiedView(self) }
    public func frame(minWidth: CGFloat? = nil, idealWidth: CGFloat? = nil, maxWidth: CGFloat? = nil, minHeight: CGFloat? = nil, idealHeight: CGFloat? = nil, maxHeight: CGFloat? = nil, alignment: Alignment = .center) -> some View { _ModifiedView(self) }
    public func padding(_ edges: Edge.Set = .all, _ length: CGFloat? = nil) -> some View { _ModifiedView(self) }
    public func padding(_ length: CGFloat) -> some View { _ModifiedView(self) }
    public func aspectRatio(_ aspectRatio: CGFloat? = nil, contentMode: ContentMode) -> some View { _ModifiedView(self) }
    public func ignoresSafeArea(_ regions: SafeAreaRegions = .all, edges: Edge.Set = .all) -> some View { _ModifiedView(self) }

    // MARK: Background, overlay, clipping
    public func background<S: ShapeStyle>(_ style: S, ignoresSafeAreaEdges edges: Edge.Set = .all) -> some View { _ModifiedView(self) }
    // Apple's View-based overload is deprecated in favour of `background(alignment:content:)`; disfavoured so that
    // `.background(Color)` picks the ShapeStyle one, as it does with the real SDK.
    @_disfavoredOverload
    public func background<V: View>(_ background: V, alignment: Alignment = .center) -> some View { _ModifiedView(self) }
    public func background<V: View>(alignment: Alignment = .center, @ViewBuilder content: () -> V) -> some View { _ModifiedView(self) }
    public func overlay<V: View>(_ overlay: V, alignment: Alignment = .center) -> some View { _ModifiedView(self) }
    public func overlay<V: View>(alignment: Alignment = .center, @ViewBuilder content: () -> V) -> some View { _ModifiedView(self) }
    public func clipShape<S: Shape>(_ shape: S, style: FillStyle = FillStyle()) -> some View { _ModifiedView(self) }

    public func safeAreaInset<V: View>(edge: VerticalEdge, alignment: HorizontalAlignment = .center, spacing: CGFloat? = nil, @ViewBuilder content: () -> V) -> some View { _ModifiedView(self) }

    // MARK: Animation and accessibility
    public func animation<V: Equatable>(_ animation: Animation?, value: V) -> some View { _ModifiedView(self) }
    public func transition(_ t: AnyTransition) -> some View { _ModifiedView(self) }
    public func accessibilityIdentifier(_ identifier: String) -> some View { _ModifiedView(self) }

    // MARK: Interaction
    public func disabled(_ disabled: Bool) -> some View { _ModifiedView(self) }
    public func onTapGesture(count: Int = 1, perform action: @escaping () -> Void) -> some View { _ModifiedView(self) }
    public func onAppear(perform action: (() -> Void)? = nil) -> some View { _ModifiedView(self) }
    public func onChange<V: Equatable>(of value: V, initial: Bool = false, _ action: @escaping (_ oldValue: V, _ newValue: V) -> Void) -> some View { _ModifiedView(self) }
    public func interactiveDismissDisabled(_ isDisabled: Bool = true) -> some View { _ModifiedView(self) }
    public func scrollDismissesKeyboard(_ mode: ScrollDismissesKeyboardMode) -> some View { _ModifiedView(self) }

    // MARK: Styles and text input
    public func buttonStyle<S: ButtonStyle>(_ style: S) -> some View { _ModifiedView(self) }
    public func textFieldStyle<S: TextFieldStyle>(_ style: S) -> some View { _ModifiedView(self) }
    public func pickerStyle<S: PickerStyle>(_ style: S) -> some View { _ModifiedView(self) }
    public func keyboardType(_ type: UIKeyboardType) -> some View { _ModifiedView(self) }
    public func autocorrectionDisabled(_ disable: Bool = true) -> some View { _ModifiedView(self) }
    public func textInputAutocapitalization(_ autocapitalization: TextInputAutocapitalization?) -> some View { _ModifiedView(self) }

    // MARK: Tabs
    public func tabItem<V: View>(@ViewBuilder _ label: () -> V) -> some View { _ModifiedView(self) }
    public func tag<V: Hashable>(_ tag: V) -> some View { _ModifiedView(self) }

    // MARK: Presentation
    public func sheet<Content: View>(isPresented: Binding<Bool>, onDismiss: (() -> Void)? = nil, @ViewBuilder content: @escaping () -> Content) -> some View { _ModifiedView(self) }
    public func alert<S: StringProtocol, A: View, M: View>(_ title: S, isPresented: Binding<Bool>, @ViewBuilder actions: () -> A, @ViewBuilder message: () -> M) -> some View { _ModifiedView(self) }
    public func alert<A: View, M: View>(_ titleKey: LocalizedStringKey, isPresented: Binding<Bool>, @ViewBuilder actions: () -> A, @ViewBuilder message: () -> M) -> some View { _ModifiedView(self) }

    // MARK: Environment
    /// iOS 17: puts an `@Observable` object into the environment.
    public func environment<T: AnyObject & Observable>(_ object: T?) -> some View { _ModifiedView(self) }
}
