package com.packdex.app;

import android.content.res.AssetManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.SystemClock;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mediapipe.framework.image.BitmapImageBuilder;
import com.google.mediapipe.framework.image.MPImage;
import com.google.mediapipe.tasks.components.containers.Embedding;
import com.google.mediapipe.tasks.core.BaseOptions;
import com.google.mediapipe.tasks.vision.core.RunningMode;
import com.google.mediapipe.tasks.vision.imageembedder.ImageEmbedder;
import com.google.mediapipe.tasks.vision.imageembedder.ImageEmbedderResult;

import java.io.IOException;
import java.io.InputStream;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "PackDexAiEmbedder")
public class PackDexAiEmbedderPlugin extends Plugin {
    private static final String MODEL_ASSET_PATH = "scanner-ai/mobilenet_v3_small.tflite";
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private ImageEmbedder embedder;
    private long initMs = -1;

    private boolean assetExists(String assetPath) {
        AssetManager assets = getContext().getAssets();
        try (InputStream ignored = assets.open(assetPath)) {
            return true;
        } catch (IOException error) {
            return false;
        }
    }

    private synchronized void ensureEmbedder() throws Exception {
        if (embedder != null) return;
        long started = SystemClock.elapsedRealtimeNanos();
        BaseOptions baseOptions = BaseOptions.builder()
            .setModelAssetPath(MODEL_ASSET_PATH)
            .build();
        ImageEmbedder.ImageEmbedderOptions options = ImageEmbedder.ImageEmbedderOptions.builder()
            .setBaseOptions(baseOptions)
            .setRunningMode(RunningMode.IMAGE)
            .setL2Normalize(true)
            .build();
        embedder = ImageEmbedder.createFromOptions(getContext(), options);
        initMs = (SystemClock.elapsedRealtimeNanos() - started) / 1_000_000L;
    }

    private float[] normalize(float[] values) {
        double sum = 0;
        for (float value : values) sum += value * value;
        double magnitude = Math.sqrt(sum);
        if (magnitude <= 0 || Double.isNaN(magnitude)) return values;
        for (int index = 0; index < values.length; index += 1) values[index] = (float)(values[index] / magnitude);
        return values;
    }

    private Bitmap decodeBase64Bitmap(String base64Image) {
        String payload = base64Image == null ? "" : base64Image.replaceFirst("^data:image/[^;]+;base64,", "");
        byte[] bytes = Base64.decode(payload, Base64.DEFAULT);
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        result.put("model", assetExists(MODEL_ASSET_PATH));
        result.put("index", assetExists("scanner-ai/catalog-embeddings.json"));
        result.put("runtime", true);
        result.put("scannerTestOnly", true);
        result.put("modelAssetPath", MODEL_ASSET_PATH);
        call.resolve(result);
    }

    @PluginMethod
    public void initialize(PluginCall call) {
        executor.execute(() -> {
            try {
                ensureEmbedder();
                JSObject result = new JSObject();
                result.put("ready", true);
                result.put("initMs", initMs);
                result.put("modelAssetPath", MODEL_ASSET_PATH);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("PackDex AI embedder initialization failed: " + error.getMessage(), error);
            }
        });
    }

    @PluginMethod
    public void embedImage(PluginCall call) {
        final String base64Image = call.getString("base64Image", "");
        executor.execute(() -> {
            Bitmap bitmap = null;
            try {
                ensureEmbedder();
                bitmap = decodeBase64Bitmap(base64Image);
                if (bitmap == null) throw new IOException("Could not decode base64 image.");
                long inferenceStarted = SystemClock.elapsedRealtimeNanos();
                MPImage mpImage = new BitmapImageBuilder(bitmap).build();
                ImageEmbedderResult result = embedder.embed(mpImage);
                List<Embedding> embeddings = result.embeddingResult().embeddings();
                if (embeddings.isEmpty()) throw new IOException("Model returned no embeddings.");
                float[] values = normalize(embeddings.get(0).floatEmbedding());
                long inferenceMs = (SystemClock.elapsedRealtimeNanos() - inferenceStarted) / 1_000_000L;
                JSArray embedding = new JSArray();
                for (float value : values) embedding.put(value);
                JSObject response = new JSObject();
                response.put("embedding", embedding);
                response.put("dimensions", values.length);
                response.put("initMs", initMs);
                response.put("inferenceMs", inferenceMs);
                response.put("l2Norm", 1.0);
                call.resolve(response);
            } catch (Exception error) {
                call.reject("PackDex AI embedding failed: " + error.getMessage(), error);
            } finally {
                if (bitmap != null) bitmap.recycle();
            }
        });
    }

    @PluginMethod
    public void release(PluginCall call) {
        releaseEmbedder();
        call.resolve(new JSObject().put("released", true));
    }

    private synchronized void releaseEmbedder() {
        if (embedder != null) {
            embedder.close();
            embedder = null;
            initMs = -1;
        }
    }

    @Override
    protected void handleOnDestroy() {
        releaseEmbedder();
        executor.shutdownNow();
        super.handleOnDestroy();
    }
}
