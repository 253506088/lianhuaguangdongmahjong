package io.github.mahjong253506088.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.window.OnBackInvokedDispatcher;
import androidx.webkit.WebViewAssetLoader;
import java.io.ByteArrayInputStream;

/** Local HTTPS assets with an origin-scoped nearby room bridge. */
public class MainActivity extends Activity {
    static final String HOST = "appassets.androidplatform.net";
    static final String GAME_URL = "https://" + HOST + "/assets/game/index.html";
    private WebView webView;
    private AlertDialog exitDialog;
    private NearbyBridge nearby;

    @SuppressLint("SetJavaScriptEnabled")
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setDecorFitsSystemWindows(false);
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(16, 43, 36));
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(false);
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse local = loader.shouldInterceptRequest(request.getUrl());
                if (local != null) return local;
                if (HOST.equals(request.getUrl().getHost())) {
                    return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", null,
                        new ByteArrayInputStream(new byte[0]));
                }
                return null;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("https".equals(uri.getScheme()) && HOST.equals(uri.getHost())) return false;
                if (request.isForMainFrame() && request.hasGesture()
                    && ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                    catch (android.content.ActivityNotFoundException ignored) { }
                }
                return true;
            }
        });
        webView.setOnApplyWindowInsetsListener((view, insets) -> {
            // Cutouts stay clear even when system bars are hidden; IME resizes the
            // actual viewport, so settings fields remain reachable in landscape.
            android.graphics.Insets safe = insets.getInsets(WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            return insets;
        });
        setContentView(webView);
        nearby = new NearbyBridge(this, webView);
        enterImmersive();
        // WebView state does not preserve the JS engine. Load a fresh local page
        // after process death; DOM storage still keeps preferences and replays.
        webView.loadUrl(GAME_URL);
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }
    }

    private void enterImmersive() {
        WindowInsetsController controller = getWindow().getInsetsController();
        if (controller != null) {
            controller.hide(WindowInsets.Type.systemBars());
            controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        }
    }

    private void handleBack() {
        if (webView.canGoBack()) { webView.goBack(); return; }
        if (exitDialog != null && exitDialog.isShowing()) return;
        webView.evaluateJavascript("window.__mahjongHandleBack ? window.__mahjongHandleBack() : false", result -> {
            if ("true".equals(result) || isFinishing()) return;
            exitDialog = new AlertDialog.Builder(this).setTitle(R.string.exit_title)
                .setMessage(nearby != null && nearby.isActive() ? R.string.nearby_exit_message : R.string.exit_message).setNegativeButton(R.string.stay, null)
                .setPositiveButton(R.string.leave, (dialog, which) -> moveTaskToBack(true)).create();
            exitDialog.show();
        });
    }

    @SuppressWarnings("deprecation")
    @Override public void onBackPressed() { handleBack(); }
    // Hardware / three-button navigation must be handled before WebView gets
    // the key. Predictive gesture navigation uses the API 33 callback above.
    @Override public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getKeyCode() == KeyEvent.KEYCODE_BACK) {
            if (event.getAction() == KeyEvent.ACTION_UP && !event.isCanceled()) handleBack();
            return true;
        }
        return super.dispatchKeyEvent(event);
    }
    @Override public void onWindowFocusChanged(boolean focused) {
        super.onWindowFocusChanged(focused);
        if (focused) enterImmersive();
    }
    @Override protected void onPause() {
        if (nearby != null) nearby.foreground(false);
        if (webView != null) { webView.onPause(); if (nearby == null || !nearby.isActive()) webView.pauseTimers(); }
        super.onPause();
    }
    @Override protected void onResume() {
        super.onResume();
        if (webView != null) { webView.resumeTimers(); webView.onResume(); }
        if (nearby != null) nearby.foreground(true);
        enterImmersive();
    }
    @Override protected void onDestroy() {
        if (nearby != null) nearby.close();
        if (exitDialog != null) exitDialog.dismiss();
        if (webView != null) { webView.stopLoading(); webView.destroy(); webView = null; }
        super.onDestroy();
    }
    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (nearby != null && nearby.onActivityResult(requestCode, resultCode, data)) return;
        super.onActivityResult(requestCode, resultCode, data);
    }
}
