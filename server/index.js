import express from 'express';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import Groq from 'groq-sdk';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import axios from 'axios';
import dns from 'dns';
import multer from 'multer';

import User from '../models/User.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';

dns.setDefaultResultOrder('ipv4first');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-key';

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => { console.error('❌ MongoDB error:', err); process.exit(1); });

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = 'llama-3.3-70b-versatile';

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ limit: '25mb', extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

const limiter = rateLimit({ windowMs: 60 * 1000, max: 60, message: { error: 'Too many requests.' } });
app.use('/api/', limiter);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, true)
});

function authenticateToken(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied.' });
  try {
    req.userId = jwt.verify(token, JWT_SECRET).userId;
    next();
  } catch {
    res.status(403).json({ error: 'Invalid or expired token.' });
  }
}

function generateTitle(msg) {
  if (!msg) return 'New Chat';
  return msg.length > 40 ? msg.slice(0, 40) + '...' : msg;
}

async function generateAITitle(message) {
  try {
    const response = await groq.chat.completions.create({
      model: MODEL,
      max_tokens: 20,
      messages: [{
        role: 'user',
        content: `Generate a short 3-6 word title for a conversation that starts with this message. Only return the title, nothing else, no quotes, capitalize the first letter of each word:\n\n"${message.slice(0, 200)}"`
      }]
    });
    const title = response.choices[0].message.content.trim().replace(/^["']|["']$/g, '');
    return title || generateTitle(message);
  } catch {
    return generateTitle(message);
  }
}

async function searchWeb(query) {
  try {
    const response = await axios.post('https://api.tavily.com/search', {
      api_key: process.env.TAVILY_API_KEY,
      query, search_depth: 'basic', include_answer: true, max_results: 5
    });
    return { answer: response.data.answer || '', results: response.data.results || [] };
  } catch (err) {
    console.error('Search error:', err.message);
    return { answer: '', results: [] };
  }
}

function needsRealTimeInfo(message) {
  const keywords = ['weather', 'temperature', 'today', 'now', 'current', 'latest', 'recent',
    'news', 'breaking', 'price', 'stock', 'crypto', 'score', 'game', 'match', 'sports', 'trending'];
  return keywords.some(k => message.toLowerCase().includes(k));
}

async function extractFileContent(buffer, mimetype, filename) {
  const ext = filename.split('.').pop().toLowerCase();

  if (mimetype === 'application/pdf' || ext === 'pdf') {
    try {
      const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
      const data = await pdfParse(buffer);
      return { text: data.text, type: 'document' };
    } catch (err) {
      throw new Error('Failed to parse PDF: ' + err.message);
    }
  }

  if (ext === 'docx' || mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    try {
      const mammoth = (await import('mammoth')).default;
      const result = await mammoth.extractRawText({ buffer });
      return { text: result.value, type: 'document' };
    } catch (err) {
      return { text: `[DOCX: ${filename}] Could not extract text: ${err.message}`, type: 'document' };
    }
  }

  if (ext === 'xlsx' || ext === 'xls') {
    try {
      const XLSX = (await import('xlsx')).default;
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      let text = '';
      workbook.SheetNames.forEach(name => {
        text += `Sheet: ${name}\n`;
        text += XLSX.utils.sheet_to_csv(workbook.Sheets[name]) + '\n\n';
      });
      return { text, type: 'document' };
    } catch (err) {
      return { text: `[Excel: ${filename}]`, type: 'document' };
    }
  }

  if (ext === 'csv') return { text: buffer.toString('utf-8'), type: 'document' };

  if (mimetype.startsWith('image/')) {
    const base64 = buffer.toString('base64');
    const fs = (await import('fs')).default;
    const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    const uniqueName = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9.]/g, '_')}`;
    fs.writeFileSync(path.join(uploadsDir, uniqueName), buffer);
    const imageUrl = `/uploads/${uniqueName}`;
    let description = '';
    try {
      const visionResponse = await groq.chat.completions.create({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mimetype};base64,${base64}` } },
            { type: 'text', text: 'Describe this image in detail. Include all visible text, objects, people, colors, layout, and any other relevant information.' }
          ]
        }],
        max_tokens: 1024
      });
      description = visionResponse.choices[0].message.content;
    } catch (err) {
      console.error('Vision error:', err.message);
      description = `[Image file: ${filename}]`;
    }
    return { text: `[Image: ${filename}]\n\nImage description:\n${description}`, type: 'image', imageUrl, imageData: base64, imageExt: ext };
  }

  const textTypes = ['js','ts','jsx','tsx','py','java','c','cpp','cs','go','rs','php','rb',
    'swift','kt','md','txt','html','css','sql','sh','json','xml','yaml','yml','env','toml',
    'ini','log','vue','svelte','r','dart','lua','perl','scala'];
  if (mimetype.startsWith('text/') || mimetype === 'application/json' || mimetype === 'application/xml' || textTypes.includes(ext)) {
    try { return { text: buffer.toString('utf-8'), type: 'document' }; }
    catch { return { text: `[File: ${filename}] Could not read as text.`, type: 'document' }; }
  }

  return { text: `[File: ${filename} | Type: ${mimetype} | Size: ${(buffer.length/1024).toFixed(1)}KB]`, type: 'document' };
}

// Upload Route
app.post('/api/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const file = req.file;
    const extracted = await extractFileContent(file.buffer, file.mimetype, file.originalname);
    res.json({
      success: true, filename: file.originalname, fileType: file.mimetype, fileSize: file.size,
      isImage: extracted.type === 'image', imageUrl: extracted.imageUrl || null,
      imageData: extracted.imageData || null, imageExt: extracted.imageExt || null,
      content: extracted.text.substring(0, 50000)
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));

// Image Generation - saves to disk
app.post('/api/generate-image', authenticateToken, async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'No prompt provided' });
  const HF_API_KEY = process.env.HF_API_KEY || '';
  if (!HF_API_KEY) return res.status(401).json({ error: 'HF_API_KEY not set.' });

  const models = [
    'black-forest-labs/FLUX.1-schnell',
    'stabilityai/stable-diffusion-xl-base-1.0',
    'runwayml/stable-diffusion-v1-5',
  ];

  for (const model of models) {
    try {
      console.log(`Trying: ${model}`);
      const response = await fetch(`https://router.huggingface.co/hf-inference/models/${model}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${HF_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: prompt }),
        signal: AbortSignal.timeout(90000)
      });
      console.log(`${model} status:`, response.status);
      if (response.ok) {
        const ct = response.headers.get('content-type') || '';
        if (ct.startsWith('image/')) {
          const arrayBuf = await response.arrayBuffer();
          const buffer = Buffer.from(arrayBuf);
          const base64 = buffer.toString('base64');

          // Save to disk for permanent URL
          const fs = (await import('fs')).default;
          const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
          if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
          const filename = `generated-${Date.now()}.jpg`;
          fs.writeFileSync(path.join(uploadsDir, filename), buffer);
          const imageUrl = `/uploads/${filename}`;

          console.log('Image saved to:', imageUrl);
          return res.json({ success: true, image_data: base64, image_url: imageUrl });
        }
      }
      if (response.status !== 503) {
        const text = await response.text();
        console.log('Error:', text.slice(0, 200));
        break;
      }
    } catch (err) {
      console.error(`${model} failed:`, err.message);
    }
  }
  res.status(500).json({ error: 'Image generation failed. Please try again.' });
});

// Save image generation messages (creates conversation if needed)
app.post('/api/chat/save-image-messages', authenticateToken, async (req, res) => {
  const { conversationId, userMessage, assistantMessage } = req.body;
  try {
    let conversation;
    if (conversationId) {
      conversation = await Conversation.findById(conversationId);
      if (conversation && conversation.userId.toString() !== req.userId) conversation = null;
    }
    if (!conversation) {
      const title = await generateAITitle(userMessage);
      conversation = await Conversation.create({ userId: req.userId, title });
    }
    await Message.create({ conversationId: conversation._id, role: 'user', content: userMessage });
    await Message.create({ conversationId: conversation._id, role: 'assistant', content: assistantMessage });
    res.json({ success: true, conversationId: conversation._id.toString(), title: conversation.title });
  } catch (err) {
    console.error('Save image messages error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Auth Routes
app.post('/api/auth/signup', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  try {
    if (await User.findOne({ email })) return res.status(400).json({ error: 'Email already registered.' });
    const user = await User.create({ email, password: await bcrypt.hash(password, 10) });
    const token = jwt.sign({ userId: user._id.toString(), email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { userId: user._id.toString(), email: user.email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create account.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });
  try {
    const user = await User.findOne({ email });
    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    const token = jwt.sign({ userId: user._id.toString(), email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { userId: user._id.toString(), email: user.email } });
  } catch (err) {
    res.status(500).json({ error: 'Login failed.' });
  }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ userId: user._id.toString(), email: user.email });
  } catch { res.status(500).json({ error: 'Failed to get user.' }); }
});

app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'All fields required.' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect.' });
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    res.json({ success: true, message: 'Password updated successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update password.' });
  }
});

// Chat Stream
app.post('/api/chat/stream', authenticateToken, async (req, res) => {
  const { message, conversationId, fileContent, fileName, isImage, imageUrl } = req.body;
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'Message is required.' });

  try {
    let conversation;
    if (conversationId) {
      conversation = await Conversation.findById(conversationId);
      if (!conversation || conversation.userId.toString() !== req.userId) {
        return res.status(403).json({ error: 'Access denied.' });
      }
    } else {
      const title = await generateAITitle(message);
      conversation = await Conversation.create({ userId: req.userId, title });
    }

    let userMessageForDB = message;
    if (fileContent && !isImage) {
      userMessageForDB = `[File: ${fileName}]\n${fileContent.substring(0, 500)}...\n\n---\n\n${message}`;
    } else if (isImage && fileContent) {
      const imgTag = imageUrl ? `\n![image](${imageUrl})` : '';
      userMessageForDB = `[Image: ${fileName}]${imgTag}\n${fileContent.substring(0, 300)}...\n\n---\n\n${message}`;
    }

    await Message.create({ conversationId: conversation._id, role: 'user', content: userMessageForDB });

    const messages = await Message.find({ conversationId: conversation._id }).sort({ createdAt: 1 });
    const history = messages.map(m => ({ role: m.role, content: m.content }));

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    res.write(`data: ${JSON.stringify({ type: 'start', conversationId: conversation._id.toString(), title: conversation.title })}\n\n`);

    let messageContent = message;
    if (fileContent && !isImage) {
      messageContent = `The user uploaded a file named "${fileName}".\n\nFull file content:\n${fileContent}\n\n---\n\nUser question: ${message}`;
    } else if (isImage && fileContent) {
      messageContent = `The user uploaded an image named "${fileName}".\n\nHere is what the image contains (analyzed by a vision model):\n${fileContent}\n\n---\n\nUser question: ${message}`;
    }

    let searchContext = '';
    if (needsRealTimeInfo(message)) {
      res.write(`data: ${JSON.stringify({ type: 'searching', query: message })}\n\n`);
      const sr = await searchWeb(message);
      if (sr.results?.length > 0) {
        searchContext = `\n\n[Web search results for: "${message}"]\n`;
        if (sr.answer) searchContext += `Summary: ${sr.answer}\n\n`;
        sr.results.forEach((r, i) => { searchContext += `${i+1}. ${r.title}\n   ${r.content}\n   Source: ${r.url}\n`; });
      }
    }

    const messagesForAI = [
      { role: 'system', content: (process.env.SYSTEM_PROMPT || 'You are Orion, a helpful AI assistant. When a user uploads a file or image, carefully read and analyze the full content provided and answer questions about it accurately.') + searchContext },
      ...history.slice(-6),
      { role: 'user', content: messageContent }
    ];

    const stream = await groq.chat.completions.create({ model: MODEL, max_tokens: 2048, stream: true, messages: messagesForAI });

    let fullResponse = '';
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || '';
      if (text) {
        fullResponse += text;
        res.write(`data: ${JSON.stringify({ type: 'delta', text })}\n\n`);
      }
    }

    await Message.create({ conversationId: conversation._id, role: 'assistant', content: fullResponse });
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();

  } catch (err) {
    console.error('Stream error:', err);
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    res.end();
  }
});

// Conversation Routes
app.get('/api/conversations', authenticateToken, async (req, res) => {
  try {
    const convs = await Conversation.find({ userId: req.userId }).sort({ createdAt: -1 });
    const list = await Promise.all(convs.map(async conv => ({
      id: conv._id.toString(), title: conv.title, createdAt: conv.createdAt,
      messageCount: await Message.countDocuments({ conversationId: conv._id })
    })));
    res.json({ conversations: list });
  } catch { res.status(500).json({ error: 'Failed to load conversations.' }); }
});

app.get('/api/conversations/:id', authenticateToken, async (req, res) => {
  try {
    const conv = await Conversation.findById(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found.' });
    if (conv.userId.toString() !== req.userId) return res.status(403).json({ error: 'Access denied.' });
    const msgs = await Message.find({ conversationId: conv._id }).sort({ createdAt: 1 });
    res.json({
      id: conv._id.toString(), title: conv.title, createdAt: conv.createdAt,
      messages: msgs.map(m => ({ role: m.role, content: m.content, createdAt: m.createdAt }))
    });
  } catch { res.status(500).json({ error: 'Failed to load conversation.' }); }
});

app.delete('/api/conversations/:id', authenticateToken, async (req, res) => {
  try {
    const conv = await Conversation.findById(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found.' });
    if (conv.userId.toString() !== req.userId) return res.status(403).json({ error: 'Access denied.' });
    await Message.deleteMany({ conversationId: conv._id });
    await Conversation.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Failed to delete.' }); }
});

// Serve Frontend
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

app.listen(PORT, () => {
  console.log(`\n🚀 Orion AI running at http://localhost:${PORT}`);
  console.log(`🤖 Model: ${MODEL}`);
  console.log(`📁 File support: PDF, DOCX, XLSX, CSV, images, all code files`);
  console.log(`👁  Vision: Llama 4 Scout`);
  console.log(`🖼  Image gen: Hugging Face FLUX + saved to disk\n`);
});
