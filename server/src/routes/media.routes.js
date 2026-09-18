import { Router } from "express";

import {
  listMediaItems,
  uploadNewMedia,
  updateExistingMedia,
  reorderMediaItems,
  removeMedia,
} from "../controllers/media.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { authorizeRoles } from "../middleware/role.middleware.js";
import { uploadMediaFile } from "../middleware/upload.middleware.js";

const router = Router();

// The entire media surface is ADMIN-ONLY: upload, list, update,
// reorder and delete are all protected server-side. Staff and
// customers are denied regardless of what the UI shows.
router.use(authenticate);
router.use(authorizeRoles("admin"));

router.get("/", listMediaItems);

// multipart/form-data, single file field named "file".
router.post("/", uploadMediaFile, uploadNewMedia);

// Literal paths must be declared before "/:id".
router.patch("/reorder", reorderMediaItems);

router.patch("/:id", updateExistingMedia);
router.delete("/:id", removeMedia);

export default router;