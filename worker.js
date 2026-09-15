/**
 * Digital Chowkidar - Cloudinary Upload Worker
 *
 * Required Cloudflare Worker variables/secrets:
 *   CLOUDINARY_CLOUD_NAME  (plain variable)
 *   CLOUDINARY_API_KEY     (secret)
 *   CLOUDINARY_API_SECRET  (secret)
 *   CLOUDINARY_UPLOAD_PRESET (plain variable)
 *
 * The Cloudinary API secret is NEVER returned to the client.
 */

const ALLOWED_RESOURCE_TYPES = new Set(["image", "video", "raw", "auto"]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store",
    },
  });
}

async function sha1Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function getConfig(env) {
  return {
    cloudName: String(env.CLOUDINARY_CLOUD_NAME || "").trim(),
    apiKey: String(env.CLOUDINARY_API_KEY || "").trim(),
    apiSecret: String(env.CLOUDINARY_API_SECRET || "").trim(),
    uploadPreset: String(env.CLOUDINARY_UPLOAD_PRESET || "").trim(),
  };
}

function validateConfig(config) {
  const missing = [];
  if (!config.cloudName) missing.push("CLOUDINARY_CLOUD_NAME");
  if (!config.apiKey) missing.push("CLOUDINARY_API_KEY");
  if (!config.apiSecret) missing.push("CLOUDINARY_API_SECRET");
  if (!config.uploadPreset) missing.push("CLOUDINARY_UPLOAD_PRESET");
  return missing;
}

function corsHeaders(request) {
  // Same-origin requests do not need CORS. If a browser/client sends an Origin,
  // only echo it back rather than using a wildcard with credentials.
  const origin = request.headers.get("Origin");
  return origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {};
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = corsHeaders(request);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...headers,
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "Content-Type, Authorization",
          "access-control-max-age": "86400",
        },
      });
    }

    // Safe diagnostic endpoint. It exposes configuration presence only;
    // the API secret itself is never exposed.
    if (url.pathname === "/api/cloudinary-debug" && request.method === "GET") {
      const config = getConfig(env);
      const missing = validateConfig(config);

      return new Response(
        JSON.stringify({
          ok: missing.length === 0,
          cloudName: config.cloudName || null,
          apiKeyPresent: Boolean(config.apiKey),
          apiKeyLength: config.apiKey.length || 0,
          apiSecretPresent: Boolean(config.apiSecret),
          uploadPreset: config.uploadPreset || null,
          missing,
        }),
        {
          status: missing.length === 0 ? 200 : 500,
          headers: {
            ...headers,
            "content-type": "application/json; charset=UTF-8",
            "cache-control": "no-store",
          },
        }
      );
    }

    if (url.pathname === "/api/cloudinary-upload" && request.method === "POST") {
      try {
        const config = getConfig(env);
        const missing = validateConfig(config);

        if (missing.length) {
          return json(
            {
              error: "Cloudinary Worker configuration is incomplete.",
              missing,
              apiKeyPresent: Boolean(config.apiKey),
              apiSecretPresent: Boolean(config.apiSecret),
              cloudNamePresent: Boolean(config.cloudName),
              uploadPresetPresent: Boolean(config.uploadPreset),
            },
            500
          );
        }

        const form = await request.formData();
        const file = form.get("file");
        const requestedType = String(form.get("resource_type") || "auto").trim().toLowerCase();
        const resourceType = ALLOWED_RESOURCE_TYPES.has(requestedType)
          ? requestedType
          : "auto";

        if (!(file instanceof File)) {
          return json({ error: "No file received. Send the file in a field named 'file'." }, 400);
        }

        // Keep obviously invalid/empty uploads out of Cloudinary.
        if (file.size <= 0) {
          return json({ error: "The selected file is empty." }, 400);
        }

        // Cloudinary signed upload: the signature covers every signed parameter.
        // Do not include api_key or file itself in the signature.
        const timestamp = Math.floor(Date.now() / 1000);
        const signatureBase =
          `timestamp=${timestamp}&upload_preset=${config.uploadPreset}${config.apiSecret}`;
        const signature = await sha1Hex(signatureBase);

        const cloudinaryForm = new FormData();
        cloudinaryForm.append("file", file);
        cloudinaryForm.append("api_key", config.apiKey);
        cloudinaryForm.append("timestamp", String(timestamp));
        cloudinaryForm.append("upload_preset", config.uploadPreset);
        cloudinaryForm.append("signature", signature);

        const cloudinaryUrl =
          `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/${resourceType}/upload`;

        const response = await fetch(cloudinaryUrl, {
          method: "POST",
          body: cloudinaryForm,
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
          return json(
            {
              error: "Cloudinary rejected the upload.",
              cloudinaryStatus: response.status,
              cloudinaryError:
                result?.error?.message || result?.message || "Unknown Cloudinary error",
              // Helpful diagnostics, but never return the secret.
              cloudName: config.cloudName,
              uploadPreset: config.uploadPreset,
              apiKeyPresent: true,
              apiSecretPresent: true,
            },
            response.status
          );
        }

        return new Response(JSON.stringify(result), {
          status: response.status,
          headers: {
            ...headers,
            "content-type": "application/json; charset=UTF-8",
            "cache-control": "no-store",
          },
        });
      } catch (error) {
        console.error("Cloudinary upload worker error:", error);
        return json(
          { error: error?.message || "Unexpected Worker error while uploading." },
          500
        );
      }
    }

    // Everything else continues to the static Digital Chowkidar app.
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return json({ error: "Not found" }, 404);
  },
};
