const DEFAULT_CLOUD_NAME = "bobsswig";
const DEFAULT_UPLOAD_PRESET = "dc_test_upload";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store"
    }
  });
}

function getConfig(env) {
  const cloudName = String(env.CLOUDINARY_CLOUD_NAME || DEFAULT_CLOUD_NAME).trim();
  const uploadPreset = String(env.CLOUDINARY_UPLOAD_PRESET || DEFAULT_UPLOAD_PRESET).trim();
  return { cloudName, uploadPreset };
}

function resourceTypeFor(file, requested) {
  const value = String(requested || "auto").toLowerCase().trim();
  if (value === "image" || value === "video" || value === "raw") return value;

  const type = String(file?.type || "").toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/") || type.startsWith("audio/")) return "video";
  return "raw";
}

async function sha1Hex(value) {
  const buffer = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function signatureString(params, apiSecret) {
  const pairs = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && String(value) !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return `${pairs}${apiSecret}`;
}

async function signedUpload({ file, resourceType, cloudName, apiKey, apiSecret, uploadPreset }) {
  const timestamp = Math.floor(Date.now() / 1000);

  // Cloudinary signs every request parameter that is sent (except file,
  // cloud_name, resource_type and api_key). The upload preset is included
  // only when we actually send it.
  const signedParams = { timestamp };
  if (uploadPreset) signedParams.upload_preset = uploadPreset;

  const signature = await sha1Hex(signatureString(signedParams, apiSecret));

  const body = new FormData();
  body.append("file", file);
  body.append("api_key", apiKey);
  body.append("timestamp", String(timestamp));
  if (uploadPreset) body.append("upload_preset", uploadPreset);
  body.append("signature", signature);

  const endpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/${resourceType}/upload`;
  const response = await fetch(endpoint, { method: "POST", body });
  const result = await response.json().catch(() => ({}));

  return { response, result };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/cloudinary-debug" && request.method === "GET") {
      const { cloudName, uploadPreset } = getConfig(env);
      return json({
        cloudName,
        apiKeyPresent: Boolean(env.CLOUDINARY_API_KEY),
        apiKeyLength: env.CLOUDINARY_API_KEY ? String(env.CLOUDINARY_API_KEY).length : 0,
        apiSecretPresent: Boolean(env.CLOUDINARY_API_SECRET),
        uploadPreset
      });
    }

    if (url.pathname === "/api/cloudinary-upload" && request.method === "POST") {
      try {
        const form = await request.formData();
        const file = form.get("file");
        const requestedResourceType = form.get("resource_type") || "auto";

        if (!(file instanceof File)) {
          return json({ error: "No file received." }, 400);
        }

        const apiKey = String(env.CLOUDINARY_API_KEY || "").trim();
        const apiSecret = String(env.CLOUDINARY_API_SECRET || "").trim();
        const { cloudName, uploadPreset } = getConfig(env);

        if (!apiKey || !apiSecret) {
          return json({
            error: "Cloudflare Cloudinary credentials are missing.",
            apiKeyPresent: Boolean(apiKey),
            apiSecretPresent: Boolean(apiSecret)
          }, 500);
        }

        if (!cloudName) {
          return json({ error: "Cloudinary cloud name is missing." }, 500);
        }

        const resourceType = resourceTypeFor(file, requestedResourceType);
        const upload = await signedUpload({
          file,
          resourceType,
          cloudName,
          apiKey,
          apiSecret,
          uploadPreset
        });

        if (!upload.response.ok) {
          return json({
            error: "Cloudinary rejected the request",
            cloudinaryStatus: upload.response.status,
            cloudinaryError:
              upload.result?.error?.message ||
              upload.result?.message ||
              "Unknown Cloudinary error",
            cloudName,
            resourceType,
            uploadPreset,
            apiKeyPresent: true,
            apiKeyLength: apiKey.length,
            apiSecretPresent: true
          }, upload.response.status);
        }

        return json(upload.result, upload.response.status);
      } catch (error) {
        return json({
          error: error?.message || String(error)
        }, 500);
      }
    }

    return env.ASSETS.fetch(request);
  }
};
