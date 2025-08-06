const express = require("express");
const router = express.Router();

module.exports = (supabase) => {
   // GET all categories sorted by parent_id then name
  router.get("/", async (req, res) => {
    const { data, error } = await supabase
      .from("categories")
      .select("*")
      .order("parent_id", { ascending: true })
      .order("name", { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    res.json(data);
  });

  // GET one category by id
  router.get("/:id", async (req, res) => {
    const { id } = req.params;
    const { data, error } = await supabase.from("categories").select("*").eq("id", id).single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  // POST create a new category
  router.post("/", async (req, res) => {
  console.log("BODY:", req.body); // <-- Log input

  const { name } = req.body;
  if (!name) {
    console.log("Missing name");
    return res.status(400).json({ error: "Name is required" });
  }

  const { data, error } = await supabase
    .from("categories")
    .insert([{ name }])
    .select();

  if (error) {
    console.error("Supabase error:", error.message);
    return res.status(500).json({ error: error.message });
  }

  console.log("Inserted category:", data);
  res.status(201).json(data);
});


  // PUT update category by id
  router.put("/:id", async (req, res) => {
    const { id } = req.params;
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "Name is required" });

    const { data, error } = await supabase.from("categories").update({ name }).eq("id", id).select();
    if (error) return res.status(500).json({ error: error.message });

    res.json(data);
  });

  // DELETE category by id
  router.delete("/:id", async (req, res) => {
    const { id } = req.params;
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) return res.status(500).json({ error: error.message });

    res.json({ message: "Category deleted successfully" });
  });

  return router;
};
