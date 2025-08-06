const express = require("express");
const sharp = require("sharp");
const router = express.Router();

function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9]/gi, "_").toLowerCase();
}

module.exports = (supabase, upload) => {
  const bucketName = "mm-files";

  // Create new partner with compressed WebP image upload
  router.post("/", upload.single("image"), async (req, res) => {
    try {
      const { title, website } = req.body;

      if (!title || !website || !req.file) {
        return res.status(400).json({ message: "Title, website and image are required" });
      }

      if (req.file.size > 20 * 1024) {
        return res.status(400).json({ message: "Image size must be under 20KB" });
      }

      const sanitizedTitle = sanitizeFilename(title);
      const fileName = `partners/${sanitizedTitle}_${Date.now()}.webp`;

      // Compress and convert to webp with sharp
      const webpBuffer = await sharp(req.file.buffer)
        .webp({ quality: 60 })
        .toBuffer();

      // Upload image to Supabase storage
      const { error: uploadError } = await supabase.storage
        .from(bucketName)
        .upload(fileName, webpBuffer, {
          contentType: "image/webp",
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) {
        return res.status(500).json({ message: "Image upload failed", error: uploadError });
      }

      // Get public URL
      const { data: urlData, error: urlError } = supabase.storage
        .from(bucketName)
        .getPublicUrl(fileName);

      if (urlError) {
        return res.status(500).json({ message: "Failed to get image URL", error: urlError });
      }

      const image_url = urlData.publicUrl;

      // Insert partner into DB
      const { data, error } = await supabase
        .from("partners")
        .insert([{ title, website, image_url }])
        .select()
        .single();

      if (error) {
        return res.status(500).json({ message: "Failed to add partner", error });
      }

      res.status(201).json(data);
    } catch (err) {
      console.error("POST /partners error:", err);
      res.status(500).json({ message: "Server error", error: err.message });
    }
  });

  // Get all partners
  router.get("/", async (req, res) => {
    try {
      const { data, error } = await supabase
        .from("partners")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      res.json(data);
    } catch (err) {
      console.error("GET /partners error:", err);
      res.status(500).json({ message: "Failed to fetch partners", error: err.message });
    }
  });



 // Update partner and delete old image if changed
router.put("/:id", upload.single("image"), async (req, res) => {
  const { id } = req.params;
  const { title, website, image_url: oldImageUrlFromBody } = req.body; // image_url sent from client as old image URL

  try {
    // 1. Fetch existing partner
    const { data: oldPartner, error: fetchError } = await supabase
      .from("partners")
      .select("image_url")
      .eq("id", id)
      .single();

    if (fetchError || !oldPartner) {
      return res.status(404).json({ error: "Partner not found" });
    }

    const oldImageUrl = oldPartner.image_url;

    // 2. Prepare variables for update
    let newImageUrl = oldImageUrl;

    // 3. If new image file uploaded, process and upload
    if (req.file) {
      // Delete old image if exists and different from oldImageUrlFromBody (or always delete old)
      if (oldImageUrl) {
        const parts = oldImageUrl.split("/");
        const bucketIndex = parts.indexOf("mm-files"); // or your bucket name
        if (bucketIndex !== -1) {
          const filePath = parts.slice(bucketIndex + 1).join("/");
          const { error: deleteImageError } = await supabase.storage
            .from("mm-files")
            .remove([filePath]);
          if (deleteImageError) {
            console.warn("Failed to delete old image:", deleteImageError.message);
          }
        }
      }

      // Process uploaded image buffer with sharp (compress/convert to webp)
      const webpBuffer = await sharp(req.file.buffer)
        .webp({ quality: 60 })
        .toBuffer();

      // Generate new filename
      const sanitizeFilename = (name) => name.replace(/[^a-z0-9]/gi, "_").toLowerCase();
      const fileName = `partners/${sanitizeFilename(title)}_${Date.now()}.webp`;

      // Upload new image
      const { error: uploadError } = await supabase.storage
        .from("mm-files")
        .upload(fileName, webpBuffer, {
          contentType: "image/webp",
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) {
        return res.status(500).json({ error: "Image upload failed", details: uploadError });
      }

      // Get new public URL
      const { data: urlData, error: urlError } = supabase.storage
        .from("mm-files")
        .getPublicUrl(fileName);

      if (urlError) {
        return res.status(500).json({ error: "Failed to get image URL", details: urlError });
      }

      newImageUrl = urlData.publicUrl;
    }

    // 4. Update partner record
    const { data, error: updateError } = await supabase
      .from("partners")
      .update({
        title,
        website,
        image_url: newImageUrl,
      })
      .eq("id", id)
      .select()
      .single();

    if (updateError) {
      return res.status(500).json({ error: "Failed to update partner", details: updateError });
    }

    res.json(data);
  } catch (err) {
    console.error("PATCH /partners/:id error:", err);
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

  // Delete partner by ID
  // DELETE a partner (or product) and its image from Supabase storage
router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    // 1. Fetch the record to get the image URL
    const { data: record, error: fetchError } = await supabase
      .from("partners") // or "products"
      .select("image_url")
      .eq("id", id)
      .single();

    if (fetchError || !record) {
      return res.status(404).json({ error: "Record not found" });
    }

    const imageUrl = record.image_url;

    // 2. Extract the file path in the bucket from the public URL
    let filePath = "";
    if (imageUrl) {
      const parts = imageUrl.split("/");
      // Adjust the folder/bucket name accordingly, e.g., "mm-files" or "partners"
      const bucketName = "mm-files";
      const bucketIndex = parts.indexOf(bucketName);
      if (bucketIndex !== -1) {
        filePath = parts.slice(bucketIndex + 1).join("/");
      }
    }

    // 3. Remove image from Supabase storage if filePath found
    if (filePath) {
      const { error: deleteImageError } = await supabase.storage
        .from("mm-files") // your bucket name here
        .remove([filePath]);

      if (deleteImageError) {
        console.warn("Warning: Failed to delete image from storage:", deleteImageError.message);
        // You can choose to continue deleting the DB record even if image deletion fails
      }
    }

    // 4. Delete the record from the database
    const { error: deleteError } = await supabase
      .from("partners") // or "products"
      .delete()
      .eq("id", id);

    if (deleteError) {
      return res.status(500).json({ error: deleteError.message });
    }

    res.json({ message: "Record and image deleted successfully" });
  } catch (err) {
    console.error("DELETE /:id error:", err);
    res.status(500).json({ error: "Server error while deleting record" });
  }
});


  return router;
};
