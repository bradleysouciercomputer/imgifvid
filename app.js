import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm';

const SUPABASE_URL = 'https://ejiydoercquflnbwablx.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_TVQRNmicJDv_UlhXAYiFNg_tE8Lj3r7';
const MAX_FILE_SIZE = 100 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 60;
const MAX_QUEUE_FILES = 10;
const BUCKET = 'media';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

const state = {
  user: null,
  posts: [],
  filter: 'all',
  search: '',
  queue: [],
  previewPost: null,
  authMode: 'signin',
  loadingFeed: false,
  uploading: false
};

const $ = (selector) => document.querySelector(selector);
const grid = $('#gallery-grid');
const emptyState = $('#empty-state');
const feedMessage = $('#feed-message');
const dropzone = $('#dropzone');
const fileInput = $('#file-input');
const queuePanel = $('#queue-panel');
const queueList = $('#queue-list');
const authDialog = $('#auth-dialog');
const authForm = $('#auth-form');
const authMessage = $('#auth-message');
const authEmail = $('#auth-email');
const authPassword = $('#auth-password');
const passwordField = $('#password-field');
const toast = $('#toast');
let toastTimer = null;

const MIME_BY_EXT = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime'
};
const ALLOWED_MIME_TYPES = new Set(Object.values(MIME_BY_EXT));

function escapeHTML(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(function () { toast.hidden = true; }, 3600);
}

function showFeedMessage(message) {
  feedMessage.textContent = message;
  feedMessage.hidden = !message;
}

function getSiteUrl() {
  const path = window.location.pathname.replace(/index\.html$/i, '');
  return window.location.origin + path;
}

function getPublicUrl(path) {
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(bytes > 10 * 1024 * 1024 ? 0 : 1) + ' MB';
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Just now';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function titleFromFilename(name) {
  return name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Untitled media';
}

function inferFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const mime = (file.type || MIME_BY_EXT[ext] || '').toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(mime)) {
    throw new Error('That file type is not supported. Choose an image, GIF, MP4, WebM, or MOV.');
  }
  if (file.size <= 0) throw new Error('That file is empty.');
  if (file.size > MAX_FILE_SIZE) throw new Error(file.name + ' is over the 100 MB file limit.');
  let kind = 'image';
  if (mime === 'image/gif' || ext === 'gif') kind = 'gif';
  if (mime.indexOf('video/') === 0) kind = 'video';
  return { mime: mime, kind: kind, extension: ext || 'bin' };
}

function getVideoDuration(file) {
  return new Promise(function (resolve, reject) {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = function () {
      const duration = video.duration;
      URL.revokeObjectURL(url);
      if (!Number.isFinite(duration)) {
        reject(new Error('Could not read video duration for ' + file.name + '.'));
      } else if (duration > MAX_VIDEO_SECONDS) {
        reject(new Error(file.name + ' is longer than 60 seconds.'));
      } else {
        resolve(duration);
      }
    };
    video.onerror = function () {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that video. Try an MP4 or WebM file.'));
    };
    video.src = url;
  });
}

function updateAuthUI() {
  const isSignedIn = Boolean(state.user);
  $('#auth-open').hidden = isSignedIn;
  $('#sign-out').hidden = !isSignedIn;
  $('#user-pill').hidden = !isSignedIn;
  $('#user-email').textContent = isSignedIn ? (state.user.email || 'Signed in') : '';
  $('#upload-note').textContent = isSignedIn
    ? 'Signed in and ready. Add up to 10 files at a time.'
    : 'You can choose files now; sign in before uploading.';
}

function renderAuthMode(mode) {
  state.authMode = mode;
  authMessage.hidden = true;
  authMessage.textContent = '';
  const switchWrap = $('#auth-switch');
  const switchLabel = $('#auth-switch span');
  const switchButton = $('#auth-switch-button');
  const forgot = $('#forgot-password');
  const passwordInput = authPassword;

  if (mode === 'signup') {
    $('#auth-kicker').textContent = 'MAKE YOURSELF AT HOME';
    $('#auth-title').innerHTML = 'Make it <span>official.</span>';
    $('#auth-subtitle').textContent = 'Create an account to upload and manage your moments.';
    $('#auth-submit').innerHTML = 'Create account <span aria-hidden="true">↗</span>';
    passwordField.hidden = false;
    passwordInput.required = true;
    passwordInput.minLength = 8;
    passwordInput.autocomplete = 'new-password';
    passwordInput.placeholder = 'At least 8 characters';
    forgot.hidden = true;
    switchLabel.textContent = 'Already have an account?';
    switchButton.textContent = 'Sign in';
    switchWrap.hidden = false;
  } else if (mode === 'reset') {
    $('#auth-kicker').textContent = 'A FRESH START';
    $('#auth-title').innerHTML = 'Reset your <span>password.</span>';
    $('#auth-subtitle').textContent = 'We will email you a link to choose a new password.';
    $('#auth-submit').innerHTML = 'Send reset link <span aria-hidden="true">↗</span>';
    passwordField.hidden = true;
    passwordInput.required = false;
    forgot.hidden = true;
    switchLabel.textContent = 'Remembered it?';
    switchButton.textContent = 'Back to sign in';
    switchWrap.hidden = false;
  } else if (mode === 'update') {
    $('#auth-kicker').textContent = 'ONE LAST THING';
    $('#auth-title').innerHTML = 'Choose a <span>new password.</span>';
    $('#auth-subtitle').textContent = 'Set a new password for your imgifvid account.';
    $('#auth-submit').innerHTML = 'Save password <span aria-hidden="true">↗</span>';
    passwordField.hidden = false;
    passwordInput.required = true;
    passwordInput.minLength = 8;
    passwordInput.autocomplete = 'new-password';
    passwordInput.placeholder = 'At least 8 characters';
    forgot.hidden = true;
    switchWrap.hidden = true;
  } else {
    $('#auth-kicker').textContent = 'GOOD TO SEE YOU';
    $('#auth-title').innerHTML = 'Welcome <span>back.</span>';
    $('#auth-subtitle').textContent = 'Sign in to share a moment or manage your posts.';
    $('#auth-submit').innerHTML = 'Sign in <span aria-hidden="true">↗</span>';
    passwordField.hidden = false;
    passwordInput.required = true;
    passwordInput.minLength = 8;
    passwordInput.autocomplete = 'current-password';
    passwordInput.placeholder = 'At least 8 characters';
    forgot.hidden = false;
    switchLabel.textContent = 'New around here?';
    switchButton.textContent = 'Create an account';
    switchWrap.hidden = false;
  }
}

function openAuth(mode) {
  renderAuthMode(mode || 'signin');
  if (!authDialog.open) authDialog.showModal();
}

function setPreviewContent(post) {
  state.previewPost = post;
  const url = getPublicUrl(post.storage_path);
  const title = post.title || titleFromFilename(post.original_name);
  $('#preview-title').textContent = title;
  $('#preview-kicker').textContent = String(post.media_kind || 'media').toUpperCase() + ' / FROM THE GALLERY';
  $('#preview-description').textContent = post.description || '';
  $('#preview-date').textContent = formatDate(post.created_at);
  $('#preview-owner').textContent = state.user && state.user.id === post.user_id ? 'Your upload' : 'Shared by a member';
  $('#preview-download').href = url;
  $('#preview-delete').hidden = !(state.user && state.user.id === post.user_id);
  const stage = $('#preview-stage');
  const safeUrl = escapeHTML(url);
  if (post.media_kind === 'video') {
    stage.innerHTML = '<video controls playsinline preload="metadata" src="' + safeUrl + '"></video>';
  } else {
    stage.innerHTML = '<img src="' + safeUrl + '" alt="' + escapeHTML(title) + '">';
  }
  if (!post.description) $('#preview-description').hidden = true;
  else $('#preview-description').hidden = false;
  $('#preview-date').title = new Date(post.created_at).toLocaleString();
  const dialog = $('#preview-dialog');
  if (!dialog.open) dialog.showModal();
}

function renderPosts() {
  const needle = state.search.trim().toLowerCase();
  const visiblePosts = state.posts.filter(function (post) {
    const kindMatches = state.filter === 'all' || post.media_kind === state.filter;
    const haystack = [post.title, post.description, post.original_name].join(' ').toLowerCase();
    return kindMatches && (!needle || haystack.indexOf(needle) !== -1);
  });
  $('#all-count').textContent = String(state.posts.length);
  grid.innerHTML = '';

  if (!state.posts.length && state.loadingFeed) {
    showFeedMessage('Loading the gallery…');
    emptyState.hidden = true;
    return;
  }
  if (!state.posts.length) {
    showFeedMessage('');
    emptyState.hidden = false;
    $('.empty-state h3').textContent = 'It’s a little quiet in here.';
    $('.empty-state p').textContent = 'Be the first to add something worth a second look.';
    return;
  }
  showFeedMessage('');
  if (!visiblePosts.length) {
    emptyState.hidden = false;
    $('.empty-state h3').textContent = 'No moments found.';
    $('.empty-state p').textContent = 'Try another filter or a different search.';
    return;
  }
  emptyState.hidden = true;

  visiblePosts.forEach(function (post, index) {
    const url = getPublicUrl(post.storage_path);
    const kindLabel = post.media_kind === 'gif' ? 'GIF' : post.media_kind === 'video' ? 'Video' : 'Image';
    const mediaElement = post.media_kind === 'video'
      ? '<video src="' + escapeHTML(url) + '" muted playsinline preload="metadata" aria-label="' + escapeHTML(post.title) + ' preview"></video><span class="video-play" aria-hidden="true">▶</span>'
      : '<img src="' + escapeHTML(url) + '" loading="lazy" alt="' + escapeHTML(post.title || post.original_name) + '">';
    const card = document.createElement('article');
    card.className = 'media-card';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', 'Open ' + (post.title || post.original_name));
    card.style.animationDelay = Math.min(index * 35, 280) + 'ms';
    card.innerHTML =
      '<div class="media-preview">' + mediaElement +
        '<span class="media-tag">' + kindLabel + '</span>' +
      '</div>' +
      '<div class="media-card-body">' +
        '<h3 class="media-card-title">' + escapeHTML(post.title || titleFromFilename(post.original_name)) + '</h3>' +
        '<p class="media-card-description">' + escapeHTML(post.description || '') + '</p>' +
        '<div class="media-card-footer"><span>' + formatDate(post.created_at) + '</span><button type="button" data-share="' + escapeHTML(post.id) + '" aria-label="Copy media link">Share ↗</button></div>' +
      '</div>';
    card.addEventListener('click', function (event) {
      if (event.target.closest('[data-share]')) return;
      setPreviewContent(post);
    });
    card.addEventListener('keydown', function (event) {
      if ((event.key === 'Enter' || event.key === ' ') && event.target === card) {
        event.preventDefault();
        setPreviewContent(post);
      }
    });
    grid.appendChild(card);
  });
}

async function loadPosts() {
  if (state.loadingFeed) return;
  state.loadingFeed = true;
  renderPosts();
  try {
    const result = await supabase.from('media_posts')
      .select('id,user_id,title,description,storage_path,original_name,mime_type,media_kind,file_size_bytes,created_at')
      .order('created_at', { ascending: false })
      .limit(90);
    if (result.error) throw result.error;
    state.posts = result.data || [];
    renderPosts();
  } catch (error) {
    console.error('Could not load gallery:', error);
    showFeedMessage('The gallery could not load. Check that the Supabase project is active and the media_posts table is set up.');
    if (!state.posts.length) emptyState.hidden = true;
  } finally {
    state.loadingFeed = false;
  }
}

function releaseQueueItem(item) {
  if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
}

function renderQueue() {
  queuePanel.hidden = state.queue.length === 0;
  $('#queue-count').textContent = '(' + state.queue.length + ')';
  queueList.innerHTML = '';
  state.queue.forEach(function (item) {
    const row = document.createElement('div');
    row.className = 'queue-item';
    const preview = item.kind === 'video'
      ? '<div class="queue-thumb queue-video-thumb">▶</div>'
      : '<img class="queue-thumb" src="' + escapeHTML(item.previewUrl) + '" alt="">';
    row.innerHTML = preview +
      '<div class="queue-file-meta"><span class="queue-file-name">' + escapeHTML(item.file.name) + '</span>' +
      '<span class="queue-file-size">' + formatBytes(item.file.size) + '</span>' +
      '<span class="queue-file-type">' + escapeHTML(item.kind) + '</span></div>' +
      '<button class="queue-remove" type="button" data-remove-queue="' + escapeHTML(item.id) + '" aria-label="Remove ' + escapeHTML(item.file.name) + '">×</button>';
    queueList.appendChild(row);
  });
  $('#queue-count').textContent = String(state.queue.length) + (state.queue.length === 1 ? ' file' : ' files');
  $('#upload-submit').disabled = state.uploading || state.queue.length === 0;
}

async function addFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  const available = MAX_QUEUE_FILES - state.queue.length;
  if (available <= 0) {
    showToast('The queue holds up to ' + MAX_QUEUE_FILES + ' files.');
    return;
  }
  const rejected = [];
  for (const file of files.slice(0, available)) {
    try {
      const info = inferFile(file);
      if (info.kind === 'video') await getVideoDuration(file);
      state.queue.push({
        id: crypto.randomUUID(),
        file: file,
        kind: info.kind,
        mime: info.mime,
        extension: info.extension,
        previewUrl: URL.createObjectURL(file)
      });
    } catch (error) {
      rejected.push(error.message || ('Could not add ' + file.name));
    }
  }
  renderQueue();
  if (rejected.length) showToast(rejected.slice(0, 2).join(' '));
  else showToast(files.length === 1 ? 'File added to your queue.' : 'Files added to your queue.');
  if (files.length > available) showToast('The queue holds up to ' + MAX_QUEUE_FILES + ' files.');
}

async function uploadQueue() {
  if (!state.user) {
    showToast('Sign in before uploading your files.');
    openAuth('signin');
    return;
  }
  if (!state.queue.length || state.uploading) return;

  state.uploading = true;
  const submitButton = $('#upload-submit');
  const progress = $('#upload-progress');
  const progressBar = progress.querySelector('span');
  submitButton.disabled = true;
  submitButton.textContent = 'Uploading…';
  progress.hidden = false;
  progressBar.style.width = '0%';

  const remaining = [];
  const issues = [];
  let completed = 0;
  const originalQueue = state.queue.slice();
  // Use the form input IDs, not the section heading IDs. Defensive
  // fallbacks prevent an absent optional field from stranding the upload UI.
  const titleField = $('#upload-post-title');
  const descriptionField = $('#upload-description');
  const sharedTitle = titleField?.value?.trim() || '';
  const description = descriptionField?.value?.trim() || '';

  for (let i = 0; i < originalQueue.length; i += 1) {
    const item = originalQueue[i];
    const path = state.user.id + '/' + crypto.randomUUID() + '.' + item.extension;
    let stored = false;
    try {
      const uploadResult = await supabase.storage.from(BUCKET).upload(path, item.file, {
        cacheControl: '3600',
        contentType: item.mime,
        upsert: false
      });
      if (uploadResult.error) throw uploadResult.error;
      stored = true;

      const insertResult = await supabase.from('media_posts').insert({
        user_id: state.user.id,
        title: (sharedTitle || titleFromFilename(item.file.name)).slice(0, 120),
        description: description.slice(0, 500),
        storage_path: path,
        original_name: item.file.name,
        mime_type: item.mime,
        media_kind: item.kind,
        file_size_bytes: item.file.size
      });
      if (insertResult.error) throw insertResult.error;
      releaseQueueItem(item);
      completed += 1;
    } catch (error) {
      if (stored) {
        const cleanup = await supabase.storage.from(BUCKET).remove([path]);
        if (cleanup.error) console.warn('Could not clean up failed upload:', cleanup.error);
      }
      remaining.push(item);
      issues.push(item.file.name + ': ' + (error.message || 'upload failed'));
    }
    progressBar.style.width = Math.round(((i + 1) / originalQueue.length) * 100) + '%';
    submitButton.textContent = 'Uploading ' + (i + 1) + ' / ' + originalQueue.length;
  }

  state.queue = remaining;
  state.uploading = false;
  progress.hidden = true;
  progressBar.style.width = '0%';
  submitButton.innerHTML = 'Upload files <span aria-hidden="true">↗</span>';
  renderQueue();

  if (completed > 0) {
    if (titleField) titleField.value = '';
    if (descriptionField) descriptionField.value = '';
    await loadPosts();
  }
  if (completed && !issues.length) showToast(completed === 1 ? 'Your post is live in the gallery.' : completed + ' posts are live in the gallery.');
  else if (completed && issues.length) showToast(completed + ' uploaded. ' + issues.length + ' need a retry.');
  else if (issues.length) showToast(issues[0].slice(0, 180));
}

function setFilter(filter) {
  state.filter = filter;
  document.querySelectorAll('[data-filter]').forEach(function (button) {
    const active = button.dataset.filter === filter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  renderPosts();
}

async function copyShareLink(postId) {
  const post = state.posts.find(function (item) { return item.id === postId; });
  if (!post) return;
  const url = getPublicUrl(post.storage_path);
  try {
    await navigator.clipboard.writeText(url);
    showToast('Public media link copied.');
  } catch (error) {
    window.prompt('Copy this public media link:', url);
  }
}

async function removeMediaObjectAndVerify(storagePath) {
  const storage = supabase.storage.from(BUCKET);
  const lastSlash = storagePath.lastIndexOf('/');
  const folder = lastSlash >= 0 ? storagePath.slice(0, lastSlash) : '';
  const fileName = lastSlash >= 0 ? storagePath.slice(lastSlash + 1) : storagePath;

  async function objectStillExists() {
    const result = await storage.list(folder, {
      limit: 100,
      search: fileName
    });
    if (result.error) {
      throw new Error('Could not verify the media file was removed: ' + result.error.message);
    }
    return (result.data || []).some(function (entry) {
      return entry.name === fileName;
    });
  }

  // Storage can return an empty successful response when the object is filtered
  // by a policy. Verify the actual object listing before deleting its DB row.
  const firstRemoval = await storage.remove([storagePath]);
  let stillExists = await objectStillExists();
  if (!stillExists) return;

  // Retry once to recover from transient Storage failures.
  const secondRemoval = await storage.remove([storagePath]);
  stillExists = await objectStillExists();
  if (stillExists) {
    const reason = secondRemoval.error || firstRemoval.error;
    throw new Error(
      reason
        ? 'The media file could not be removed from Storage: ' + reason.message
        : 'Storage did not remove the media file. The post was kept so you can retry.'
    );
  }
}

async function deletePreviewPost() {
  const post = state.previewPost;
  if (!post || !state.user || post.user_id !== state.user.id) return;
  const accepted = window.confirm('Delete this post permanently? The media file will no longer be available.');
  if (!accepted) return;
  const button = $('#preview-delete');
  button.disabled = true;
  button.textContent = 'Deleting…';
  try {
    // Do not delete the gallery row until Storage confirms the object is gone.
    await removeMediaObjectAndVerify(post.storage_path);
    const rowResult = await supabase.from('media_posts').delete().eq('id', post.id);
    if (rowResult.error) throw rowResult.error;
    $('#preview-dialog').close();
    state.previewPost = null;
    state.posts = state.posts.filter(function (item) { return item.id !== post.id; });
    renderPosts();
    showToast('Post deleted.');
  } catch (error) {
    console.error('Delete failed:', error);
    showToast(error.message || 'Could not delete this post.');
  } finally {
    button.disabled = false;
    button.textContent = 'Delete my post';
  }
}

authForm.addEventListener('submit', async function (event) {
  event.preventDefault();
  authMessage.hidden = true;
  const mode = state.authMode;
  const email = authEmail.value.trim();
  const password = authPassword.value;
  const submit = $('#auth-submit');
  submit.disabled = true;
  const original = submit.textContent;
  submit.textContent = mode === 'reset' ? 'Sending…' : mode === 'update' ? 'Saving…' : 'Please wait…';
  try {
    let result;
    if (mode === 'signup') {
      if (password.length < 8) throw new Error('Choose a password with at least 8 characters.');
      result = await supabase.auth.signUp({
        email: email,
        password: password,
        options: { emailRedirectTo: getSiteUrl() }
      });
      if (result.error) throw result.error;
      if (result.data.session) {
        authDialog.close();
        showToast('Account created. Welcome to imgifvid!');
      } else {
        authMessage.textContent = 'Account created. Check your email for a confirmation link, then come back and sign in.';
        authMessage.hidden = false;
      }
    } else if (mode === 'reset') {
      result = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: getSiteUrl() + '?reset-password=1'
      });
      if (result.error) throw result.error;
      authMessage.textContent = 'If an account exists for that email, a reset link is on its way.';
      authMessage.hidden = false;
    } else if (mode === 'update') {
      if (password.length < 8) throw new Error('Choose a password with at least 8 characters.');
      result = await supabase.auth.updateUser({ password: password });
      if (result.error) throw result.error;
      authDialog.close();
      window.history.replaceState({}, document.title, getSiteUrl());
      showToast('Password updated. You are all set.');
    } else {
      result = await supabase.auth.signInWithPassword({ email: email, password: password });
      if (result.error) throw result.error;
      authDialog.close();
      showToast('You are signed in. Let’s share something.');
    }
  } catch (error) {
    authMessage.textContent = error.message || 'Something went wrong. Please try again.';
    authMessage.hidden = false;
  } finally {
    const preservedMessage = authMessage.textContent;
    submit.disabled = false;
    renderAuthMode(state.authMode);
    if (preservedMessage) {
      authMessage.textContent = preservedMessage;
      authMessage.hidden = false;
    }
  }
});

$('#auth-open').addEventListener('click', function () { openAuth('signin'); });
$('#sign-out').addEventListener('click', async function () {
  const result = await supabase.auth.signOut();
  if (result.error) showToast(result.error.message);
  else showToast('Signed out safely.');
});
$('#auth-close').addEventListener('click', function () { authDialog.close(); });
$('#forgot-password').addEventListener('click', function () { renderAuthMode('reset'); });
$('#auth-switch-button').addEventListener('click', function () {
  if (state.authMode === 'signup') renderAuthMode('signin');
  else renderAuthMode(state.authMode === 'reset' ? 'signin' : 'signup');
});
authDialog.addEventListener('click', function (event) {
  if (event.target === authDialog) authDialog.close();
});

dropzone.addEventListener('click', function () {
  fileInput.click();
});
fileInput.addEventListener('change', async function () {
  await addFiles(fileInput.files);
  fileInput.value = '';
});
dropzone.addEventListener('dragover', function (event) {
  event.preventDefault();
  dropzone.classList.add('is-dragging');
});
dropzone.addEventListener('dragleave', function () {
  dropzone.classList.remove('is-dragging');
});
dropzone.addEventListener('drop', async function (event) {
  event.preventDefault();
  dropzone.classList.remove('is-dragging');
  await addFiles(event.dataTransfer.files);
});
$('#clear-queue').addEventListener('click', function () {
  state.queue.forEach(releaseQueueItem);
  state.queue = [];
  renderQueue();
});
queueList.addEventListener('click', function (event) {
  const button = event.target.closest('[data-remove-queue]');
  if (!button) return;
  const id = button.dataset.removeQueue;
  const item = state.queue.find(function (entry) { return entry.id === id; });
  if (item) releaseQueueItem(item);
  state.queue = state.queue.filter(function (entry) { return entry.id !== id; });
  renderQueue();
});
$('#upload-submit').addEventListener('click', uploadQueue);
document.querySelectorAll('[data-filter]').forEach(function (button) {
  button.addEventListener('click', function () { setFilter(button.dataset.filter); });
});
$('#gallery-search').addEventListener('input', function (event) {
  state.search = event.target.value;
  renderPosts();
});
grid.addEventListener('click', function (event) {
  const button = event.target.closest('[data-share]');
  if (button) {
    event.stopPropagation();
    copyShareLink(button.dataset.share);
  }
});
$('#refresh-feed').addEventListener('click', loadPosts);
$('#preview-close').addEventListener('click', function () { $('#preview-dialog').close(); });
$('#preview-dialog').addEventListener('click', function (event) {
  if (event.target === $('#preview-dialog')) $('#preview-dialog').close();
});
$('#preview-delete').addEventListener('click', deletePreviewPost);
$('#preview-dialog').addEventListener('close', function () {
  $('#preview-stage').innerHTML = '';
  state.previewPost = null;
});

supabase.auth.onAuthStateChange(function (event, session) {
  state.user = session ? session.user : null;
  updateAuthUI();
  if (['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT', 'PASSWORD_RECOVERY', 'USER_UPDATED'].includes(event)) {
    window.setTimeout(function () {
      loadPosts();
    }, 0);
  }
  if (event === 'PASSWORD_RECOVERY') {
    openAuth('update');
  }
});

async function boot() {
  const result = await supabase.auth.getSession();
  state.user = result.data && result.data.session ? result.data.session.user : null;
  updateAuthUI();
  renderQueue();
  await loadPosts();
  if (new URLSearchParams(window.location.search).has('reset-password')) {
    openAuth('update');
  }
}

boot().catch(function (error) {
  console.error('App initialization failed:', error);
  showFeedMessage('The app could not finish initializing. Refresh the page and try again.');
});