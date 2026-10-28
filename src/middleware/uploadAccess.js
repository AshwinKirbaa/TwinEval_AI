const path = require('path');
const { pool } = require('../config/db');
const { sendError } = require('../utils/responseHandler');

const uploadDir = path.join(__dirname, '..', '..', 'uploads');

/**
 * Authorizes access to files under /uploads. A file is served only if it is
 * referenced by a record the requester is allowed to see:
 *   - profile photo (Users.avatar_url)        -> any signed-in user
 *   - answer sheet (Submission)               -> the submitting student, the
 *                                                paper's teacher, or an admin
 *   - question paper source (QuestionPaper)   -> its teacher or an admin
 * Anything unreferenced is treated as not found.
 */
const serveUpload = async (req, res, next) => {
    try {
        const name = path.basename(decodeURIComponent(req.path));
        if (!name || name.startsWith('.')) return sendError(res, 'File not found.', 404);
        const url = `/uploads/${name}`;
        const { user_id: userId, role } = req.user;
        const isAdmin = role === 'admin';

        const [avatars] = await pool.execute(`SELECT 1 FROM Users WHERE avatar_url = ? LIMIT 1`, [url]);
        if (avatars.length) return sendFile(res, name);

        const [subs] = await pool.execute(
            `SELECT st.user_id AS student_user_id, qp.teacher_id
             FROM Submission s
             JOIN Student st ON st.student_id = s.student_id
             JOIN QuestionPaper qp ON qp.paper_id = s.paper_id
             WHERE s.answer_file_path = ? LIMIT 1`,
            [url]
        );
        if (subs.length) {
            const owner = subs[0];
            if (isAdmin || owner.student_user_id === userId || owner.teacher_id === userId) return sendFile(res, name);
            return sendError(res, 'You do not have permission to view this file.', 403);
        }

        const [papers] = await pool.execute(`SELECT teacher_id FROM QuestionPaper WHERE source_file_path = ? LIMIT 1`, [url]);
        if (papers.length) {
            if (isAdmin || papers[0].teacher_id === userId) return sendFile(res, name);
            return sendError(res, 'You do not have permission to view this file.', 403);
        }

        return sendError(res, 'File not found.', 404);
    } catch (error) {
        next(error);
    }
};

function sendFile(res, name) {
    res.set('Cache-Control', 'private, no-store');
    res.sendFile(name, { root: uploadDir, dotfiles: 'deny' });
}

module.exports = { serveUpload };
