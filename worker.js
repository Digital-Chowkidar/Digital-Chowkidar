export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Cloudinary signed-upload endpoint
    if (url.pathname === "/api/cloudinary-upload" && request.method === "POST") {
      try {
        const form = await request.formData();
        const file = form.get("file");
        const resourceType = form.get("resource_type") || "auto";

        if (!(file instanceof File)) {
          return Response.json(
            { error: "No file received." },
            { status: 400 }
          );
        }

        const timestamp = Math.floor(Date.now() / 1000);

        // Cloudinary signature is SHA-1 of:
        // timestamp=<timestamp>&upload_preset=<preset> + API secret
        const uploadPreset = "dc_test_upload";
        const signatureBase =
          `timestamp=${timestamp}&upload_preset=${uploadPreset}${env.CLOUDINARY_API_SECRET}`;

        const hashBuffer = await crypto.subtle.digest(
          "SHA-1",
          new TextEncoder().encode(signatureBase)
        );

        const signature = [...new Uint8Array(hashBuffer)]
          .map(b => b.toString(16).padStart(2, "0"))
          .join("");

        const cloudinaryForm = new FormData();
        cloudinaryForm.append("file", file);
        cloudinaryForm.append("api_key", env.CLOUDINARY_API_KEY);
        cloudinaryForm.append("timestamp", String(timestamp));
        cloudinaryForm.append("upload_preset", uploadPreset);
        cloudinaryForm.append("signature", signature);

        const response = await fetch(
          `https://api.cloudinary.com/v1_1/bobsswig/${resourceType}/upload`,
          {
            method: "POST",
            body: cloudinaryForm
          }
        );

        const result = await response.json();

        return Response.json(result, {
          status: response.status
        });
      } catch (error) {
        return Response.json(
          { error: error?.message || String(error) },
          { status: 500 }
        );
      }
    }

    return env.ASSETS.fetch(request);
  }
};
