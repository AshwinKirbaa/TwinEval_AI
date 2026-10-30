const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const uploadDir = path.join(__dirname, '..', '..', 'uploads');
const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'twineval-uploads';

function safeName(name) {
    return path.basename(name || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function persistUpload(file, folder = 'files') {
    if (!file || !file.buffer) throw new Error('Uploaded file buffer is missing.');
    const objectName = `${folder}/${Date.now()}-${Math.round(Math.random() * 1e9)}-${safeName(file.originalname)}`;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (url && key) {
        const supabase = createClient(url, key, { auth: { persistSession: false } });
        const { error } = await supabase.storage.from(bucket).upload(objectName, file.buffer, {
            contentType: file.mimetype || 'application/octet-stream',
            upsert: false
        });
        if (error) throw new Error(`File storage failed: ${error.message}`);
        const { data } = supabase.storage.from(bucket).getPublicUrl(objectName);
        return data.publicUrl;
    }

    fs.mkdirSync(uploadDir, { recursive: true });
    const filename = path.basename(objectName);
    fs.writeFileSync(path.join(uploadDir, filename), file.buffer);
    return `/uploads/${filename}`;
}

module.exports = { persistUpload };
