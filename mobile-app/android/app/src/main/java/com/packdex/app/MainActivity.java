package com.packdex.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @SuppressWarnings({ "rawtypes", "unchecked" })
    private void registerScannerAiPluginIfBundled() {
        try {
            String className = String.join("", "com.packdex.app.", "PackDex", "Ai", "Embedder", "Plugin");
            registerPlugin((Class) Class.forName(className));
        } catch (ClassNotFoundException ignored) {
            // The scanner-AI bridge is packaged only by the dedicated POC build.
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerScannerAiPluginIfBundled();
        super.onCreate(savedInstanceState);
        // Keep CSS typography at its authored size instead of applying Android's
        // WebView-only text zoom. Page/pinch zoom accessibility remains unchanged.
        getBridge().getWebView().getSettings().setTextZoom(100);
    }
}
