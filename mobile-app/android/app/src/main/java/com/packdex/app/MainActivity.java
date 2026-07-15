package com.packdex.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Keep CSS typography at its authored size instead of applying Android's
        // WebView-only text zoom. Page/pinch zoom accessibility remains unchanged.
        getBridge().getWebView().getSettings().setTextZoom(100);
    }
}
