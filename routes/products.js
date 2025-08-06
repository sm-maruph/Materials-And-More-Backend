const express = require("express");
const router = express.Router();

module.exports = (supabase) => {
  // GET all products or filtered by category & subcategory
router.get("/", async (req, res) => {
  try {
    const { category, subcategory } = req.query;
    console.log(category, subcategory);
    // Start query builder for products with category relation
    let query = supabase
      .from("products")
      .select(`
        *,
        category:category_id (
          id,
          name,
          parent:parent_id (
            id,
            name
          )
        )
      `);

    // If category filter present, add eq filter on category name
    if (category) {
      query = query.eq("category.name", category);
    }

    // If subcategory filter present, add eq filter on parent category name
    if (subcategory) {
      query = query.eq("category.parent.name", subcategory);
    }

    // Execute the query
    const { data, error } = await query;

    if (error) {
      console.error("Supabase error:", error.message);
      return res.status(500).json({ error: error.message });
    }

    // Map data to enrich with category and subcategory strings
    const enriched = data.map((product) => ({
  ...product,
  subcategory: product.category?.name || null,
  category: product.category?.parent?.name || null,
}));

    res.json(enriched);
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});



// GET related products by category and subcategory, excluding current product by optional id
router.get("/related", async (req, res) => {
  try {
    const { excludeId, subcategoryId } = req.query;

    if (!excludeId || !subcategoryId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Get subcategory data (including parent_id)
    const { data: subcategoryData, error: subError } = await supabase
      .from("categories")
      .select("id, name, parent_id")
      .eq("id", subcategoryId)
      .single();

    if (subError || !subcategoryData) {
      return res.status(500).json({ error: "Could not fetch subcategory data" });
    }

    const parentCategoryId = subcategoryData.parent_id;

    if (!parentCategoryId) {
      return res.status(400).json({ error: "This subcategory has no parent category" });
    }

    // Fetch parent category name
    const { data: parentCategoryData, error: parentError } = await supabase
      .from("categories")
      .select("id, name")
      .eq("id", parentCategoryId)
      .single();

    if (parentError || !parentCategoryData) {
      return res.status(500).json({ error: "Could not fetch parent category data" });
    }

    // Fetch related products from same subcategory
    const { data: subRelated, error: subRelatedError } = await supabase
      .from("products")
      .select(`
        *,
        category:category_id (
          id,
          name,
          parent:parent_id (
            id,
            name
          )
        )
      `)
      .eq("category_id", subcategoryId)
      .neq("id", excludeId);

    if (subRelatedError) {
      return res.status(500).json({ error: "Could not fetch subcategory related products" });
    }

    // Fetch related products from other subcategories with same parent
    const { data: catRelated, error: catRelatedError } = await supabase
      .from("products")
      .select(`
        *,
        category:category_id (
          id,
          name,
          parent:parent_id (
            id,
            name
          )
        )
      `)
      .neq("id", excludeId);

    if (catRelatedError) {
      return res.status(500).json({ error: "Could not fetch category related products" });
    }

    // Filter products from different subcategories but same parent category
    const filteredCatRelated = catRelated.filter(
      (p) =>
        p.category?.parent?.id === parentCategoryId &&
        p.category?.id !== subcategoryData.id
    );

    // Respond with related products + names
    res.json({
      subcategoryRelated: subRelated || [],
      categoryRelated: filteredCatRelated || [],
      subcategoryName: subcategoryData.name,
      categoryName: parentCategoryData.name,
    });

  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});




router.get("/:id", async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from("products")
    .select(
      `
      *,
      category:category_id (
        id,
        name,
        parent:parent_id (
          id,
          name
        )
      )
    `
    )
    .eq("id", id)
    .single();

  if (error || !data) {
    console.error("Error fetching product by ID:", error?.message);
    return res.status(404).json({ error: "Product not found" });
  }

  const enriched = {
    ...data,
    subcategory: data.category?.name || null, // ✅ subcategory
    category: data.category?.parent?.name || null, // ✅ main category
  };

  res.json(enriched);
});

  // POST create a product
  router.post("/", async (req, res) => {
    console.log("API hit with body:", req.body);

    const { name, category_id, description, price, image_url, specifications } = req.body;

    // Ensure specifications is an array
    const fixedSpecs = Array.isArray(specifications)
      ? specifications
      : typeof specifications === "string"
      ? specifications.split(",").map((s) => s.trim())
      : [];

    const { data, error } = await supabase
      .from("products")
      .insert([{ name, category_id, description, price, image_url, specifications: fixedSpecs }])
      .select();

    if (error) {
      console.error("Supabase insert error:", error);
      return res.status(500).json({ error: error.message });
    }

    res.status(201).json(data);
  });
  // POST create a product
  router.post("/", async (req, res) => {
  console.log("api hit with body:", req.body);
  const { name, category_id, description, price, image_url, specifications } = req.body;

  if (specifications && !Array.isArray(specifications)) {
    return res.status(400).json({ error: "Specification must be an array" });
  }

  const { data, error } = await supabase
    .from("products")
    .insert([{ name, category_id, description, price, image_url, specifications }])
    .select();

  if (error) {
    console.error("Supabase insert error:", error);
    return res.status(500).json({ error: error.message });
  }

  res.status(201).json(data);
});


 // PUT update a product (and delete old image if changed)
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { name, category_id, description, price, image_url, specifications } = req.body;

  if (specifications && !Array.isArray(specifications)) {
    return res.status(400).json({ error: "Specification must be an array" });
  }

  try {
    // 1. Fetch existing product
    const { data: oldProduct, error: fetchError } = await supabase
      .from("products")
      .select("image_url")
      .eq("id", id)
      .single();

    if (fetchError || !oldProduct) {
      return res.status(404).json({ error: "Product not found" });
    }

    const oldImageUrl = oldProduct.image_url;

    // 2. If image is updated, remove the old one from bucket
    if (image_url && oldImageUrl && image_url !== oldImageUrl) {
      const parts = oldImageUrl.split("/");
      const uploadsIndex = parts.indexOf("uploads"); // Adjust if folder name is different
      if (uploadsIndex !== -1) {
        const filePath = parts.slice(uploadsIndex).join("/");
        const { error: deleteImageError } = await supabase.storage
          .from("mm-files") // Replace with your bucket name
          .remove([filePath]);

        if (deleteImageError) {
          console.warn("Warning: Failed to delete old image from bucket:", deleteImageError.message);
        }
      }
    }

    // 3. Update the product
    const { data, error } = await supabase
      .from("products")
      .update({ name, category_id, description, price, image_url, specifications })
      .eq("id", id)
      .select();

    if (error) return res.status(500).json({ error: error.message });

    res.json(data);
  } catch (e) {
    console.error("Update failed:", e);
    res.status(500).json({ error: "Server error while updating product" });
  }
});


  // DELETE a product and its image
router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    // 1. Fetch the product to get the image URL
    const { data: product, error: fetchError } = await supabase
      .from("products")
      .select("image_url")
      .eq("id", id)
      .single();

    if (fetchError || !product) {
      return res.status(404).json({ error: "Product not found" });
    }

    const imageUrl = product.image_url;

    // 2. Extract image file path from public URL
    let filePath = "";
    if (imageUrl) {
      const parts = imageUrl.split("/"); // e.g., .../object/public/<bucket>/<folder>/<filename>
      const uploadsIndex = parts.indexOf("uploads"); // adjust if your folder name is different
      if (uploadsIndex !== -1) {
        filePath = parts.slice(uploadsIndex).join("/"); // uploads/folder/filename.png
      }
    }

    // 3. Remove the file from the Supabase bucket
    if (filePath) {
      const { error: deleteImageError } = await supabase.storage
        .from("mm-files") // change to your actual bucket name
        .remove([filePath]);

      if (deleteImageError) {
        console.warn("Warning: Failed to delete image from bucket:", deleteImageError.message);
      }
    }

    // 4. Delete the product from the database
    const { error: deleteError } = await supabase
      .from("products")
      .delete()
      .eq("id", id);

    if (deleteError) {
      return res.status(500).json({ error: deleteError.message });
    }

    res.json({ message: "Product and image deleted successfully" });

  } catch (e) {
    console.error("Deletion failed:", e);
    res.status(500).json({ error: "Server error while deleting product" });
  }
});


// POST /delete-image
router.post("/delete-image", async (req, res) => {
  const { path } = req.body;
  if (!path) return res.status(400).json({ error: "Image path is required" });

  const { error } = await supabase.storage
    .from("mm-files")
    .remove([path]);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({ message: "Old image deleted" });
});


  return router;
};
