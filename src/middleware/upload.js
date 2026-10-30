const multer = require('multer');
const path = require('path');

const ALLOWED_EXT = ['.pdf', '.png', '.jpg', '.jpeg', '.docx', '.txt'];

const fileFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
        return cb(new Error(`Unsupported file type "${ext}". Allowed: ${ALLOWED_EXT.join(', ')}`));
    }
    cb(null, true);
};

const upload = multer({
    // Keep the request portable: storageService persists to Supabase in
    // production or to ./uploads during local development.
    storage: multer.memoryStorage(),
    fileFilter,
    limits: { fileSize: 25 * 1024 * 1024 } // 25MB -- matches the frontend's own validation
});

module.exports = upload;
