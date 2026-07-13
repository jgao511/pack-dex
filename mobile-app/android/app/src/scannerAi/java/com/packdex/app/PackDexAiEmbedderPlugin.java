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

import org.json.JSONObject;
import org.tensorflow.lite.DataType;
import org.tensorflow.lite.Interpreter;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "PackDexAiEmbedder")
public class PackDexAiEmbedderPlugin extends Plugin {
    private static final String MODEL_ASSET_PATH = "scanner-ai/mobilenet_v3_small.tflite";
    private static final String INDEX_METADATA_ASSET_PATH = "public/scanner-ai/catalog-embeddings.meta.json";
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private Interpreter interpreter;
    private ByteBuffer modelBuffer;
    private long initMs = -1;
    private String activeModelSha256;
    private int inputWidth;
    private int inputHeight;
    private int inputChannels;
    private int outputDimensions;
    private String inputNormalization;

    private boolean assetExists(String assetPath) {
        AssetManager assets = getContext().getAssets();
        try (InputStream ignored = assets.open(assetPath)) {
            return true;
        } catch (IOException error) {
            return false;
        }
    }

    private byte[] readAssetBytes(String assetPath) throws IOException {
        try (InputStream input = getContext().getAssets().open(assetPath); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            return output.toByteArray();
        }
    }

    private String readAssetText(String assetPath) throws IOException {
        return new String(readAssetBytes(assetPath), StandardCharsets.UTF_8);
    }

    private String indexVectorAssetPath() throws Exception {
        JSONObject metadata = new JSONObject(readAssetText(INDEX_METADATA_ASSET_PATH));
        String vectorFile = metadata.optString("vectorFile", "catalog-embeddings.f16");
        if (vectorFile.contains("/") || vectorFile.contains("\\") || vectorFile.contains("..")) throw new IOException("Invalid scanner-AI vector filename.");
        return "public/scanner-ai/" + vectorFile;
    }

    private String catalogMetadataAssetPath() throws Exception {
        JSONObject metadata = new JSONObject(readAssetText(INDEX_METADATA_ASSET_PATH));
        String metadataFile = metadata.optString("metadataFile", "catalog-metadata.json");
        if (metadataFile.contains("/") || metadataFile.contains("\\") || metadataFile.contains("..")) throw new IOException("Invalid scanner-AI catalog metadata filename.");
        return "public/scanner-ai/" + metadataFile;
    }

    private String sha256(byte[] bytes) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        digest.update(bytes);
        StringBuilder output = new StringBuilder(64);
        for (byte value : digest.digest()) output.append(String.format("%02x", value & 0xff));
        return output.toString();
    }

    private String sha256Asset(String assetPath) throws Exception {
        return sha256(readAssetBytes(assetPath));
    }

    private JSONObject deployedModelMetadata() {
        try { return new JSONObject(readAssetText(INDEX_METADATA_ASSET_PATH)).optJSONObject("model"); }
        catch (Exception ignored) { return null; }
    }

    private void validateTensorContract(JSONObject modelMetadata) throws Exception {
        int[] inputShape = interpreter.getInputTensor(0).shape();
        int[] outputShape = interpreter.getOutputTensor(0).shape();
        if (interpreter.getInputTensor(0).dataType() != DataType.FLOAT32 || inputShape.length != 4 || inputShape[0] != 1 || inputShape[3] != 3) {
            throw new IOException("Scanner-AI model must accept float32 NHWC [1,H,W,3].");
        }
        if (interpreter.getOutputTensor(0).dataType() != DataType.FLOAT32 || outputShape.length != 2 || outputShape[0] != 1 || outputShape[1] <= 0) {
            throw new IOException("Scanner-AI model must return float32 [1,dimensions].");
        }
        inputHeight = inputShape[1];
        inputWidth = inputShape[2];
        inputChannels = inputShape[3];
        outputDimensions = outputShape[1];

        JSONObject input = modelMetadata == null ? null : modelMetadata.optJSONObject("input");
        JSONObject output = modelMetadata == null ? null : modelMetadata.optJSONObject("output");
        inputNormalization = input == null ? "minus-one-to-one" : input.optString("normalization", "");
        if (!"zero-to-one".equals(inputNormalization) && !"minus-one-to-one".equals(inputNormalization)) {
            throw new IOException("Scanner-AI model metadata has an unsupported input normalization.");
        }
        if (input != null && (input.optInt("width") != inputWidth || input.optInt("height") != inputHeight || input.optInt("channels") != inputChannels || !"float32".equals(input.optString("dtype")))) {
            throw new IOException("Scanner-AI input tensor does not match frozen model metadata.");
        }
        if (output != null && (output.optInt("dimensions") != outputDimensions || !"float32".equals(output.optString("dtype")))) {
            throw new IOException("Scanner-AI output tensor does not match frozen model metadata.");
        }
    }

    private synchronized void ensureInterpreter() throws Exception {
        if (interpreter != null) return;
        if (!assetExists(MODEL_ASSET_PATH)) throw new IOException("No bundled scanner-AI model was found.");
        long started = SystemClock.elapsedRealtimeNanos();
        byte[] modelBytes = readAssetBytes(MODEL_ASSET_PATH);
        activeModelSha256 = sha256(modelBytes);
        JSONObject modelMetadata = deployedModelMetadata();
        String declaredSha256 = modelMetadata == null ? "" : modelMetadata.optString("sha256", modelMetadata.optString("fileSha256", ""));
        if (!declaredSha256.isEmpty() && !activeModelSha256.equals(declaredSha256)) throw new IOException("Scanner-AI model bytes do not match frozen metadata.");
        modelBuffer = ByteBuffer.allocateDirect(modelBytes.length).order(ByteOrder.nativeOrder());
        modelBuffer.put(modelBytes).rewind();
        Interpreter.Options options = new Interpreter.Options();
        options.setNumThreads(Math.max(2, Math.min(4, Runtime.getRuntime().availableProcessors())));
        try {
            interpreter = new Interpreter(modelBuffer, options);
            validateTensorContract(modelMetadata);
        } catch (Exception error) {
            if (interpreter != null) interpreter.close();
            interpreter = null;
            modelBuffer = null;
            throw error;
        }
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

    private ByteBuffer prepareInput(Bitmap source) {
        Bitmap scaled = Bitmap.createScaledBitmap(source, inputWidth, inputHeight, true);
        int[] pixels = new int[inputWidth * inputHeight];
        scaled.getPixels(pixels, 0, inputWidth, 0, 0, inputWidth, inputHeight);
        if (scaled != source) scaled.recycle();
        ByteBuffer input = ByteBuffer.allocateDirect(inputWidth * inputHeight * inputChannels * 4).order(ByteOrder.nativeOrder());
        for (int pixel : pixels) {
            float red = (pixel >> 16) & 0xff;
            float green = (pixel >> 8) & 0xff;
            float blue = pixel & 0xff;
            if ("zero-to-one".equals(inputNormalization)) {
                input.putFloat(red / 255f); input.putFloat(green / 255f); input.putFloat(blue / 255f);
            } else {
                input.putFloat((red - 127.5f) / 127.5f); input.putFloat((green - 127.5f) / 127.5f); input.putFloat((blue - 127.5f) / 127.5f);
            }
        }
        input.rewind();
        return input;
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        result.put("model", assetExists(MODEL_ASSET_PATH));
        boolean indexAvailable = false;
        try { indexAvailable = assetExists(INDEX_METADATA_ASSET_PATH) && assetExists(indexVectorAssetPath()) && assetExists(catalogMetadataAssetPath()); } catch (Exception ignored) {}
        result.put("index", indexAvailable);
        result.put("runtime", true);
        result.put("scannerTestOnly", true);
        result.put("modelAssetPath", MODEL_ASSET_PATH);
        try { result.put("modelFileSha256", sha256Asset(MODEL_ASSET_PATH)); } catch (Exception ignored) { result.put("modelFileSha256", JSONObject.NULL); }
        result.put("indexMetadataAssetPath", INDEX_METADATA_ASSET_PATH);
        call.resolve(result);
    }

    @PluginMethod
    public void getIndexAssetUrls(PluginCall call) {
        executor.execute(() -> {
            try {
                String vectorAssetPath = indexVectorAssetPath();
                if (!assetExists(INDEX_METADATA_ASSET_PATH) || !assetExists(vectorAssetPath) || !assetExists(catalogMetadataAssetPath())) throw new IOException("Bundled scanner-AI index is incomplete.");
                String localUrl = getBridge().getLocalUrl();
                if (localUrl.endsWith("/")) localUrl = localUrl.substring(0, localUrl.length() - 1);
                JSObject result = new JSObject();
                result.put("metadataUrl", localUrl + "/scanner-ai/catalog-embeddings.meta.json");
                result.put("vectorUrl", localUrl + "/scanner-ai/" + new java.io.File(vectorAssetPath).getName());
                result.put("localOnly", true);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Bundled scanner-AI index preload failed: " + error.getMessage(), error);
            }
        });
    }

    @PluginMethod
    public void initialize(PluginCall call) {
        executor.execute(() -> {
            try {
                ensureInterpreter();
                JSObject result = new JSObject();
                result.put("ready", true);
                result.put("initMs", initMs);
                result.put("modelAssetPath", MODEL_ASSET_PATH);
                result.put("modelFileSha256", activeModelSha256);
                result.put("inputWidth", inputWidth);
                result.put("inputHeight", inputHeight);
                result.put("inputNormalization", inputNormalization);
                result.put("dimensions", outputDimensions);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("PackDex AI interpreter initialization failed: " + error.getMessage(), error);
            }
        });
    }

    @PluginMethod
    public void embedImage(PluginCall call) {
        final String base64Image = call.getString("base64Image", "");
        executor.execute(() -> {
            Bitmap bitmap = null;
            try {
                ensureInterpreter();
                bitmap = decodeBase64Bitmap(base64Image);
                if (bitmap == null) throw new IOException("Could not decode base64 image.");
                ByteBuffer input = prepareInput(bitmap);
                float[][] output = new float[1][outputDimensions];
                long inferenceStarted = SystemClock.elapsedRealtimeNanos();
                interpreter.run(input, output);
                float[] values = normalize(output[0]);
                long inferenceMs = (SystemClock.elapsedRealtimeNanos() - inferenceStarted) / 1_000_000L;
                JSArray embedding = new JSArray();
                for (float value : values) embedding.put(value);
                JSObject response = new JSObject();
                response.put("embedding", embedding);
                response.put("dimensions", values.length);
                response.put("initMs", initMs);
                response.put("inferenceMs", inferenceMs);
                response.put("l2Norm", 1.0);
                response.put("modelFileSha256", activeModelSha256);
                response.put("inputNormalization", inputNormalization);
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
        releaseInterpreter();
        call.resolve(new JSObject().put("released", true));
    }

    private synchronized void releaseInterpreter() {
        if (interpreter != null) {
            interpreter.close();
            interpreter = null;
            modelBuffer = null;
            initMs = -1;
            activeModelSha256 = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        releaseInterpreter();
        executor.shutdownNow();
        super.handleOnDestroy();
    }
}
