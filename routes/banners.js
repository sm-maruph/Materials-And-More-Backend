const express = require("express");
const sharp = require("sharp");
const router = express.Router();

function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9]/gi, "_").toLowerCase();
}

module.exports = (supabase, upload) => {
  router.post("/", upload.single("image"), async (req, res) => {
  try {
    const { title } = req.body;
    console.log("Received request with title:", title);
    if (!title || !req.file) {
      console.log("Missing title or image");
      return res.status(400).json({ message: "Title and image required" });
    }

    const sanitizedTitle = sanitizeFilename(title);
    const fileName = `banners/${sanitizedTitle}.webp`;

    console.log("Compressing image...");
    const webpBuffer = await sharp(req.file.buffer)
      .webp({ quality: 60 })
      .toBuffer();

    console.log("Uploading image as:", fileName);
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("mm-files")
      .upload(fileName, webpBuffer, {
        contentType: "image/webp",
        upsert: true,
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      return res.status(500).json({ message: "Image upload failed", error: uploadError });
    }
    console.log("Image uploaded");

    // Correct destructuring here
    const { data: urlData, error: urlError } = supabase.storage
      .from("mm-files")
      .getPublicUrl(fileName);

    if (urlError) {
      console.error("Public URL error:", urlError);
      return res.status(500).json({ message: "Failed to get image URL", error: urlError });
    }

    const publicURL = urlData.publicUrl;
    console.log("Public URL:", publicURL);

    console.log("Inserting banner into DB...");
    const { data, error } = await supabase
      .from("banners")
      .insert([{ title, image_url: publicURL }])
      .select()
      .single();

    if (error) {
      console.error("Insert error:", error);
      return res.status(500).json({ message: "Failed to add banner", error });
    }

    console.log("Banner inserted successfully:", data);
    res.json(data);
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});


  // Get all banners route remains unchanged...
  router.get("/", async (req, res) => {
    const { data, error } = await supabase
      .from("banners")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      return res
        .status(500)
        .json({ message: "Failed to fetch banners", error });
    }
    res.json(data);
  });

   // Delete banner by id
  router.delete("/:id", async (req, res) => {
    const { id } = req.params;
    const { image_url } = req.body;

    if (!image_url) {
      return res.status(400).json({ message: "Image URL required to delete image from storage" });
    }

    try {
      // Extract storage path from public URL
      // Example URL: https://[supabase-url]/storage/v1/object/public/mm-files/banners/banner.webp
      const url = new URL(image_url);
      const pathname = url.pathname; // "/storage/v1/object/public/mm-files/banners/banner.webp"
      const parts = pathname.split("/");

      // Assuming your bucket name is "mm-files" as before
      const bucketName = "mm-files";

      // Extract path inside the bucket
      // parts after "mm-files" e.g. ["banners/banner.webp"]
      const bucketIndex = parts.findIndex(part => part === bucketName);
      if (bucketIndex === -1) {
        return res.status(400).json({ message: "Invalid image URL" });
      }
      const filePath = parts.slice(bucketIndex + 1).join("/");

      // Delete image from Supabase storage
      const { error: deleteError } = await supabase.storage
        .from(bucketName)
        .remove([filePath]);

      if (deleteError) {
        console.error("Failed to delete image from storage:", deleteError);
        return res.status(500).json({ message: "Failed to delete image from storage", error: deleteError });
      }

      // Delete banner record from DB
      const { data, error } = await supabase
        .from("banners")
        .delete()
        .eq("id", id);

      if (error) {
        return res.status(500).json({ message: "Failed to delete banner", error });
      }

      res.json({ message: "Banner deleted successfully" });
    } catch (err) {
      console.error("Delete banner error:", err);
      res.status(500).json({ message: "Server error", error: err.message });
    }
  });

  return router;
};
