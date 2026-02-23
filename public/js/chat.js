const token = localStorage.getItem('token');
if (!token) window.location.href = '/login.html';

const user = JSON.parse(localStorage.getItem('user') || '{}');

const chatArea = document.getElementById('chatArea');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const newChatBtn = document.getElementById('newChatBtn');
const clearBtn = document.getElementById('clearBtn');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const chatTitle = document.getElementById('chatTitle');
const conversationsList = document.getElementById('conversationsList');
const userEmail = document.getElementById('userEmail');
const logoutBtn = document.getElementById('logoutBtn');
const fileBtn = document.getElementById('fileBtn');
const fileInput = document.getElementById('fileInput');
const filePreview = document.getElementById('filePreview');
const fileName = document.getElementById('fileName');
const fileSize = document.getElementById('fileSize');
const fileIcon = document.getElementById('fileIcon');
const fileRemove = document.getElementById('fileRemove');
const imageGenBtn = document.getElementById('imageGenBtn');
const imageModal = document.getElementById('imageModal');
const closeImageModal = document.getElementById('closeImageModal');
const imagePromptInput = document.getElementById('imagePrompt');
const generateImageBtn = document.getElementById('generateImageBtn');
const imageResult = document.getElementById('imageResult');
const generatedImg = document.getElementById('generatedImg');
const downloadImgBtn = document.getElementById('downloadImgBtn');
const imageError = document.getElementById('imageError');
const imageLoading = document.getElementById('imageLoading');

let uploadedFile = null;
let fileContent = null;
let uploadedFileIsImage = false;
let uploadedImageData = null;
let uploadedImageUrl = null;
let conversationId = null;
let conversations = [];
let isStreaming = false;

userEmail.textContent = user.email || 'User';

loadConversations().then(() => {
  const lastConvId = localStorage.getItem('lastConversationId');
  if (lastConvId) switchConversation(lastConvId);
});

messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 180) + 'px';
});
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

// ─── File Upload ──────────────────────────────────────────────────────────────
fileBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) { alert('File too large. Maximum size is 20MB.'); return; }
  uploadedFile = file;
  const isImage = file.type.startsWith('image/');
  const isPDF = file.type === 'application/pdf';
  fileIcon.textContent = isImage ? '🖼️' : (isPDF ? '📄' : '📝');
  fileName.textContent = file.name;
  fileSize.textContent = formatFileSize(file.size);
  filePreview.style.display = 'flex';
  setStatus(isImage ? 'Analyzing image with vision AI...' : 'Processing file...', true);
  try {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Upload failed');
    if (data.success) {
      fileContent = data.content;
      uploadedFileIsImage = data.isImage;
      uploadedImageData = data.imageData;
      uploadedImageUrl = data.imageUrl;
      setStatus(`✓ File ready: ${file.name}`);
    }
  } catch (err) {
    alert('Failed to upload file: ' + err.message);
    removeFile();
  }
});

fileRemove.addEventListener('click', removeFile);

function removeFile() {
  uploadedFile = null; fileContent = null; uploadedFileIsImage = false;
  uploadedImageData = null; uploadedImageUrl = null;
  fileInput.value = ''; filePreview.style.display = 'none'; setStatus('Ready');
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

sendBtn.addEventListener('click', sendMessage);
newChatBtn.addEventListener('click', createNewConversation);
clearBtn.addEventListener('click', clearCurrentConversation);
logoutBtn.addEventListener('click', logout);

// ─── Voice Input ──────────────────────────────────────────────────────────────
const micBtn = document.getElementById('micBtn');
let recognition = null;
let isListening = false;

if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onstart = () => {
    isListening = true;
    micBtn.classList.add('listening');
    setStatus('🎤 Listening...', true);
  };

  recognition.onresult = (e) => {
    const transcript = Array.from(e.results).map(r => r[0].transcript).join('');
    messageInput.value = transcript;
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 180) + 'px';
  };

  recognition.onend = () => {
    isListening = false;
    micBtn.classList.remove('listening');
    setStatus('Ready');
    // Auto send if something was transcribed
    if (messageInput.value.trim()) sendMessage();
  };

  recognition.onerror = (e) => {
    isListening = false;
    micBtn.classList.remove('listening');
    setStatus(e.error === 'not-allowed' ? '⚠ Microphone access denied' : 'Ready');
  };

  micBtn.addEventListener('click', () => {
    if (isListening) {
      recognition.stop();
    } else {
      recognition.start();
    }
  });
} else {
  micBtn.style.display = 'none'; // Hide if browser doesn't support
}

function setStatus(text, loading = false) {
  statusText.textContent = text;
  statusDot.className = 'status-dot' + (loading ? ' loading' : '');
}

function appendMessage(role, text = '', withCursor = false) {
  const emptyState = document.getElementById('emptyState');
  if (emptyState) emptyState.remove();
  const wrap = document.createElement('div');
  wrap.className = `message ${role}`;
  const avatar = document.createElement('div');
  avatar.className = `avatar ${role}`;
  avatar.textContent = role === 'ai' ? 'OR' : 'ME';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  if (withCursor) {
    const cursor = document.createElement('span');
    cursor.className = 'cursor';
    bubble.appendChild(cursor);
  }
  wrap.appendChild(avatar);
  wrap.appendChild(bubble);
  chatArea.appendChild(wrap);
  setTimeout(() => chatArea.scrollTo({ top: chatArea.scrollHeight, behavior: 'smooth' }), 0);
  return bubble;
}

function renderStoredMessage(role, content) {
  const bubble = appendMessage(role, '');
  const imgMatch = content.match(/!\[image\]\(([^)]+)\)/);
  if (imgMatch) {
    const imgUrl = imgMatch[1];
    const textWithoutImg = content.replace(/!\[image\]\([^)]+\)/, '').trim();
    bubble.innerHTML = `
      <img src="${imgUrl}" style="max-width:500px;width:100%;border-radius:8px;margin-bottom:8px;display:block;" onerror="this.style.display='none'" />
      <button onclick="(()=>{const a=document.createElement('a');a.href='${imgUrl}';a.download='orion-image.jpg';a.click()})()"
        style="margin-top:4px;padding:6px 14px;background:transparent;border:1px solid #555;border-radius:6px;color:inherit;cursor:pointer;font-size:0.82rem;">
        ⬇ Download
      </button>
      ${textWithoutImg ? `<br><small style="opacity:0.6">${textWithoutImg}</small>` : ''}
    `;
  } else {
    bubble.textContent = content;
  }
}
async function saveImageMessages(userMsg, assistantMsg) {
  try {
    const res = await fetch('/api/chat/save-image-messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ conversationId, userMessage: userMsg, assistantMessage: assistantMsg })
    });
    const data = await res.json();
    if (data.conversationId) {
      conversationId = data.conversationId;
      localStorage.setItem('lastConversationId', conversationId);
      if (data.title) chatTitle.textContent = data.title;
      loadConversations();
    }
  } catch (err) {
    console.error('Failed to save image messages:', err);
  }
}

async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || isStreaming) return;

  // ─── Image generation from prompt ────────────────────────────────────────
// Ask AI to classify intent
let isImageRequest = false;
let imagePromptText = text;

if (!uploadedFile) {
  try {
    const intentRes = await fetch('/api/chat/classify-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ message: text })
    });
    const intentData = await intentRes.json();
    isImageRequest = intentData.isImage;
    imagePromptText = intentData.prompt || text;
  } catch {}
}

if (isImageRequest) {
  const prompt = imagePromptText;
    messageInput.value = '';
    appendMessage('user', text);
    setStatus('Generating image...', true);
    const aiBubble = appendMessage('ai', '⏳ Generating image, please wait...');
    try {
      const response = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ prompt })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Failed');
      const src = `data:image/jpeg;base64,${data.image_data}`;
      const imageUrl = data.image_url || src;
      aiBubble.innerHTML = `Here's your generated image:<br>
        <img src="${imageUrl}" style="max-width:500px;width:100%;border-radius:8px;margin-top:8px;" alt="Generated" onerror="this.src='${src}'" /><br>
        <button onclick="(()=>{const a=document.createElement('a');a.href='${src}';a.download='orion-image.jpg';a.click()})()"
          style="margin-top:8px;padding:6px 14px;background:transparent;border:1px solid #555;border-radius:6px;color:inherit;cursor:pointer;">⬇ Download</button>`;
      await saveImageMessages(text, `Generated image for: "${prompt}"\n![image](${imageUrl})`);
    } catch (err) {
      aiBubble.textContent = '⚠ Image generation failed: ' + err.message;
    } finally {
      setStatus('Ready');
    }
    return;
  }

  isStreaming = true;
  sendBtn.disabled = true;
  messageInput.value = '';
  messageInput.style.height = 'auto';

  if (uploadedFileIsImage && uploadedFile) {
    const userBubble = appendMessage('user', '');
    const reader = new FileReader();
    reader.onload = (e) => {
      userBubble.innerHTML = `<img src="${e.target.result}" style="max-width:200px;border-radius:8px;margin-bottom:6px;display:block;" />${text}`;
    };
    reader.readAsDataURL(uploadedFile);
  } else {
    appendMessage('user', uploadedFile ? `📎 ${uploadedFile.name}\n${text}` : text);
  }

  setStatus('Thinking...', true);
  const aiBubble = appendMessage('ai', '', true);
  const cursor = aiBubble.querySelector('.cursor');
  let accumulatedText = '';

  try {
    const response = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        message: text, conversationId, fileContent,
        fileName: uploadedFile?.name, isImage: uploadedFileIsImage, imageUrl: uploadedImageUrl
      }),
    });
    if (!response.ok) throw new Error('Failed to get response');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        try {
          const data = JSON.parse(line.slice(5).trim());
          if (data.type === 'start') {
            conversationId = data.conversationId;
            localStorage.setItem('lastConversationId', conversationId);
            if (data.title) chatTitle.textContent = data.title;
            loadConversations();
          } else if (data.type === 'searching') {
            setStatus(`🔍 Searching: ${data.query}`, true);
          } else if (data.type === 'delta') {
            accumulatedText += data.text;
            aiBubble.textContent = accumulatedText;
            aiBubble.appendChild(cursor);
            chatArea.scrollTo({ top: chatArea.scrollHeight, behavior: 'smooth' });
          } else if (data.type === 'done') {
            cursor.remove();
            setStatus('Ready');
            loadConversations();
            removeFile();
          } else if (data.type === 'error') {
            cursor.remove();
            aiBubble.textContent = '⚠️ Error: ' + data.message;
            setStatus('Error');
          }
        } catch (_) {}
      }
    }
  } catch (err) {
    console.error(err);
    cursor?.remove();
    aiBubble.textContent = '⚠️ Network error';
    setStatus('Error');
  } finally {
    isStreaming = false;
    sendBtn.disabled = false;
    messageInput.focus();
  }
}

async function loadConversations() {
  try {
    const res = await fetch('/api/conversations', { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();
    conversations = data.conversations;
    renderConversationsList();
  } catch (err) { console.error(err); }
}

function renderConversationsList() {
  conversationsList.innerHTML = '';
  if (conversations.length === 0) {
    conversationsList.innerHTML = '<div class="empty-sidebar">Start a new conversation</div>';
    return;
  }
  conversations.forEach(conv => {
    const item = document.createElement('div');
    item.className = 'conversation-item';
    if (conv.id === conversationId) item.classList.add('active');
    const title = document.createElement('div');
    title.className = 'conversation-title';
    title.textContent = conv.title;
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.textContent = '×';
    deleteBtn.onclick = (e) => { e.stopPropagation(); deleteConversation(conv.id); };
    item.appendChild(title);
    item.appendChild(deleteBtn);
    item.onclick = () => switchConversation(conv.id);
    conversationsList.appendChild(item);
  });
}

async function switchConversation(id) {
  conversationId = id;
  localStorage.setItem('lastConversationId', id);
  chatArea.innerHTML = '';
  try {
    const res = await fetch(`/api/conversations/${id}`, { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();
    chatTitle.textContent = data.title;
    data.messages.forEach(msg => {
      const role = msg.role === 'assistant' ? 'ai' : msg.role;
      renderStoredMessage(role, msg.content);
    });
    renderConversationsList();
  } catch (err) { console.error(err); }
}

function createNewConversation() {
  conversationId = null;
  localStorage.removeItem('lastConversationId');
  chatArea.innerHTML = '<div class="empty-state" id="emptyState"><h2>Hey, I\'m Orion</h2><p>Your AI assistant</p></div>';
  chatTitle.textContent = 'New Chat';
  removeFile();
  renderConversationsList();
  messageInput.focus();
}

async function clearCurrentConversation() {
  if (!conversationId) return;
  await deleteConversation(conversationId);
  createNewConversation();
}

async function deleteConversation(id) {
  try {
    await fetch(`/api/conversations/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
    await loadConversations();
    if (id === conversationId) createNewConversation();
  } catch (err) { console.error(err); }
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  localStorage.removeItem('lastConversationId');
  window.location.href = '/';
}

// ─── Image Generation Modal ───────────────────────────────────────────────────
imageGenBtn.addEventListener('click', () => { imageModal.style.display = 'flex'; imagePromptInput.focus(); });
closeImageModal.addEventListener('click', () => { imageModal.style.display = 'none'; });
imageModal.addEventListener('click', (e) => { if (e.target === imageModal) imageModal.style.display = 'none'; });

generateImageBtn.addEventListener('click', async () => {
  const prompt = imagePromptInput.value.trim();
  if (!prompt) return;
  imageError.style.display = 'none';
  imageResult.style.display = 'none';
  imageLoading.style.display = 'block';
  generateImageBtn.disabled = true;
  generateImageBtn.textContent = 'Generating...';
  try {
    const response = await fetch('/api/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ prompt })
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || 'Failed to generate image');
    const src = `data:image/jpeg;base64,${data.image_data}`;
    const imageUrl = data.image_url || src;
    generatedImg.src = imageUrl;
    imageResult.style.display = 'block';
    downloadImgBtn.onclick = () => {
      const link = document.createElement('a');
      link.href = src;
      link.download = 'orion-generated.jpg';
      link.click();
    };
    appendMessage('user', `🖼 Generate image: ${prompt}`);
    const aiBubble = appendMessage('ai', '');
    aiBubble.innerHTML = `<img src="${imageUrl}" style="max-width:500px;width:100%;border-radius:8px;margin-top:8px;" alt="Generated" onerror="this.src='${src}'" /><br>
      <small style="opacity:0.6">Prompt: ${prompt}</small>`;
    await saveImageMessages(`🖼 Generate image: ${prompt}`, `Generated image for: "${prompt}"\n![image](${imageUrl})`);
  } catch (err) {
    imageError.textContent = '⚠ ' + err.message;
    imageError.style.display = 'block';
  } finally {
    imageLoading.style.display = 'none';
    generateImageBtn.disabled = false;
    generateImageBtn.textContent = 'Generate Image';
  }
});
