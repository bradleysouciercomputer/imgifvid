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
  postPagePost: null,
  profilePageId: null,
  myProfile: null,
  profilesById: Object.create(null),
  postComments: [],
  commentSubmitting: false,
  savingProfile: false,
  avatarPreviewUrl: null,
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
let orphanCleanupRunning = false;
let orphanAvatarCleanupRunning = false;

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

function getAvatarUrl(path) {
  return supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
}

function getProfileUrl(profileId) {
  const url = new URL(getSiteUrl(), window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('profile', profileId);
  return url.href;
}

function getInitials(name) {
  const parts = String(name || 'Member').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'M';
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2)).toUpperCase();
}

function getPostUrl(postId) {
  const url = new URL(getSiteUrl(), window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('post', postId);
  return url.href;
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
  $('#profile-open').hidden = !isSignedIn;
  $('#user-pill').hidden = !isSignedIn;
  $('#user-email').textContent = isSignedIn
    ? (state.myProfile?.display_name || state.user.email || 'Signed in')
    : '';
  $('#upload-note').textContent = isSignedIn
    ? 'Signed in and ready. Add up to 10 files at a time.'
    : 'You can choose files now; sign in before uploading.';
  renderCommentComposer();
}

async function loadMyProfile() {
  if (!state.user) {
    state.myProfile = null;
    updateAuthUI();
    return null;
  }
  const userId = state.user.id;
  const result = await supabase.from('profiles')
    .select('id,display_name,bio,avatar_path,created_at,updated_at')
    .eq('id', userId)
    .maybeSingle();
  if (result.error) throw result.error;

  let profile = result.data;
  if (!profile) {
    const suggestedName = (state.user.email || 'Member').split('@')[0].trim().slice(0, 32) || 'Member';
    const inserted = await supabase.from('profiles').insert({
      id: userId,
      display_name: suggestedName,
      bio: ''
    }).select('id,display_name,bio,avatar_path,created_at,updated_at').single();
    if (inserted.error) throw inserted.error;
    profile = inserted.data;
  }

  state.myProfile = profile;
  state.profilesById[profile.id] = profile;
  updateAuthUI();
  return profile;
}

async function loadProfiles(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  const missing = ids.filter(function (id) { return !state.profilesById[id]; });
  if (!missing.length) return state.profilesById;

  const result = await supabase.from('profiles')
    .select('id,display_name,bio,avatar_path,created_at,updated_at')
    .in('id', missing);
  if (result.error) throw result.error;
  for (const profile of result.data || []) {
    state.profilesById[profile.id] = profile;
  }
  return state.profilesById;
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
      window.location.assign(getPostUrl(post.id));
    });
    card.addEventListener('keydown', function (event) {
      if ((event.key === 'Enter' || event.key === ' ') && event.target === card) {
        event.preventDefault();
        window.location.assign(getPostUrl(post.id));
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

async function copyPostLink(post) {
  if (!post) return;
  const url = getPostUrl(post.id);
  try {
    await navigator.clipboard.writeText(url);
    showToast('Post link copied. Share the imgifvid page!');
  } catch (error) {
    window.prompt('Copy this imgifvid post link:', url);
  }
}

async function copyShareLink(postId) {
  const post = state.posts.find(function (item) { return item.id === postId; });
  if (!post) return;
  await copyPostLink(post);
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

async function removeAvatarObjectAndVerify(storagePath) {
  const ownerId = state.user && state.user.id;
  const lastSlash = typeof storagePath === 'string' ? storagePath.lastIndexOf('/') : -1;
  const folder = lastSlash >= 0 ? storagePath.slice(0, lastSlash) : '';
  const fileName = lastSlash >= 0 ? storagePath.slice(lastSlash + 1) : '';

  if (!ownerId || folder !== ownerId || !fileName) {
    throw new Error('You can only remove your own profile picture.');
  }

  const storage = supabase.storage.from('avatars');

  async function objectStillExists() {
    const result = await storage.list(folder, { limit: 100, search: fileName });
    if (result.error) {
      throw new Error('Could not verify that the profile picture was removed from Storage: ' + result.error.message);
    }
    return (result.data || []).some(function (entry) {
      return entry.name === fileName && Boolean(entry.id || entry.metadata);
    });
  }

  const firstRemoval = await storage.remove([storagePath]);
  let stillExists = await objectStillExists();
  if (!stillExists) return;

  const secondRemoval = await storage.remove([storagePath]);
  stillExists = await objectStillExists();
  if (stillExists) {
    const reason = secondRemoval.error || firstRemoval.error;
    throw new Error(
      reason
        ? 'The profile picture is still in Storage: ' + reason.message
        : 'Storage did not remove the profile picture. It was kept linked to your profile so you can retry.'
    );
  }
}

async function cleanupOrphanedMediaObjects() {
  // A removed gallery row can leave a raw Storage object behind if an older
  // delete path only removed the database record. Limit cleanup to this signed-in
  // user's folder and only remove objects that have no matching post row.
  if (!state.user || orphanCleanupRunning) return;
  orphanCleanupRunning = true;
  const ownerId = state.user.id;

  try {
    const referencedPaths = new Set();
    let rowOffset = 0;
    const rowPageSize = 1000;

    while (true) {
      const rows = await supabase
        .from('media_posts')
        .select('id,storage_path')
        .eq('user_id', ownerId)
        .order('id', { ascending: true })
        .range(rowOffset, rowOffset + rowPageSize - 1);

      if (rows.error) throw rows.error;
      for (const row of rows.data || []) referencedPaths.add(row.storage_path);
      if (!rows.data || rows.data.length < rowPageSize) break;
      rowOffset += rows.data.length;
    }

    const ownerFiles = [];
    let fileOffset = 0;
    const filePageSize = 100;

    while (true) {
      const listed = await supabase.storage.from(BUCKET).list(ownerId, {
        limit: filePageSize,
        offset: fileOffset,
        sortBy: { column: 'name', order: 'asc' }
      });

      if (listed.error) throw listed.error;
      const entries = listed.data || [];
      ownerFiles.push(...entries.filter(function (entry) {
        // Folders have a null id/metadata; uploaded objects have a storage id.
        return Boolean(entry.id || entry.metadata);
      }));
      if (entries.length < filePageSize) break;
      fileOffset += entries.length;
    }

    let removedCount = 0;
    for (const file of ownerFiles) {
      if (state.user?.id !== ownerId) return;
      const path = ownerId + '/' + file.name;
      if (referencedPaths.has(path)) continue;

      // Avoid racing a recent upload before its gallery row has been inserted.
      const createdAt = Date.parse(file.created_at || '');
      const oneHourAgo = Date.now() - (60 * 60 * 1000);
      if (!Number.isFinite(createdAt) || createdAt > oneHourAgo) continue;

      await removeMediaObjectAndVerify(path);
      removedCount += 1;
    }

    if (removedCount > 0) {
      console.info('Removed ' + removedCount + ' orphaned imgifvid Storage object(s).');
      showToast(removedCount + ' old orphaned media file(s) cleaned up.');
    }
  } catch (error) {
    // Do not delete database rows as part of cleanup. A failed verification is
    // logged so that a temporary Storage issue cannot cause additional loss.
    console.warn('Could not clean orphaned media objects:', error);
  } finally {
    orphanCleanupRunning = false;
  }
}

async function cleanupOrphanedAvatarObjects() {
  if (!state.user || orphanAvatarCleanupRunning) return;
  orphanAvatarCleanupRunning = true;
  const ownerId = state.user.id;

  try {
    const profileResult = await supabase.from('profiles')
      .select('avatar_path')
      .eq('id', ownerId)
      .maybeSingle();
    if (profileResult.error) throw profileResult.error;
    const currentAvatarPath = profileResult.data ? profileResult.data.avatar_path : null;

    const ownerFiles = [];
    let fileOffset = 0;
    const filePageSize = 100;
    const storage = supabase.storage.from('avatars');

    while (true) {
      const listed = await storage.list(ownerId, {
        limit: filePageSize,
        offset: fileOffset,
        sortBy: { column: 'name', order: 'asc' }
      });
      if (listed.error) throw listed.error;
      const entries = listed.data || [];
      ownerFiles.push(...entries.filter(function (entry) {
        return Boolean(entry.id || entry.metadata);
      }));
      if (entries.length < filePageSize) break;
      fileOffset += entries.length;
    }

    let removedCount = 0;
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    for (const file of ownerFiles) {
      if (state.user?.id !== ownerId) return;
      const path = ownerId + '/' + file.name;
      if (path === currentAvatarPath) continue;

      // Preserve recent uploads to avoid racing the profile save request.
      const createdAt = Date.parse(file.created_at || '');
      if (!Number.isFinite(createdAt) || createdAt > oneHourAgo) continue;

      try {
        await removeAvatarObjectAndVerify(path);
        removedCount += 1;
      } catch (error) {
        console.warn('Could not remove an orphaned profile picture:', path, error);
      }
    }

    if (removedCount > 0) {
      console.info('Removed ' + removedCount + ' orphaned avatar Storage object(s).');
      showToast(removedCount + ' old profile picture file(s) cleaned up.');
    }
  } catch (error) {
    console.warn('Could not clean orphaned profile pictures:', error);
  } finally {
    orphanAvatarCleanupRunning = false;
  }
}

function deletePreviewPost() {
  const post = state.postPagePost || state.previewPost;
  if (!post || !state.user || post.user_id !== state.user.id) return;
  const deletingFromPostPage = Boolean(state.postPagePost && state.postPagePost.id === post.id);
  const accepted = window.confirm('Delete this post permanently? The media file will no longer be available.');
  if (!accepted) return;
  const button = deletingFromPostPage ? $('#post-page-delete') : $('#preview-delete');
  button.disabled = true;
  button.textContent = 'Deleting…';
  try {
    // Do not delete the gallery row until Storage confirms the object is gone.
    await removeMediaObjectAndVerify(post.storage_path);
    const rowResult = await supabase.from('media_posts').delete().eq('id', post.id);
    if (rowResult.error) throw rowResult.error;
    state.posts = state.posts.filter(function (item) { return item.id !== post.id; });
    if (deletingFromPostPage) {
      state.postPagePost = null;
      showToast('Post deleted.');
      window.location.assign('./#discover');
      return;
    }
    $('#preview-dialog').close();
    state.previewPost = null;
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

$('#profile-open').addEventListener('click', function () {
  if (state.user) window.location.assign(getProfileUrl(state.user.id));
});
$('#profile-share').addEventListener('click', async function () {
  if (!state.profilePageId) return;
  const url = getProfileUrl(state.profilePageId);
  try {
    await navigator.clipboard.writeText(url);
    showToast('Profile link copied.');
  } catch (error) {
    window.prompt('Copy this profile link:', url);
  }
});
$('#profile-form').addEventListener('submit', saveProfile);
$('#profile-avatar-remove').addEventListener('click', removeProfilePhoto);
$('#profile-avatar-input').addEventListener('change', function (event) {
  const file = event.target.files[0];
  if (!file) return;
  if (state.avatarPreviewUrl) URL.revokeObjectURL(state.avatarPreviewUrl);
  state.avatarPreviewUrl = URL.createObjectURL(file);
  const image = $('#profile-page-avatar');
  image.src = state.avatarPreviewUrl;
  image.alt = 'New profile picture preview';
  image.hidden = false;
  $('#profile-page-avatar-fallback').hidden = true;
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
$('#post-page-share').addEventListener('click', function () {
  copyPostLink(state.postPagePost);
});
$('#post-page-delete').addEventListener('click', deletePreviewPost);
$('#comments-sign-in').addEventListener('click', function () { openAuth('signin'); });
$('#comment-form').addEventListener('submit', submitPostComment);
$('#comment-body').addEventListener('input', function (event) {
  $('#comment-char-count').textContent = event.target.value.length + '/1000';
  setCommentMessage('', false);
});
$('#comments-list').addEventListener('click', function (event) {
  const button = event.target.closest('[data-delete-comment]');
  if (button) deletePostComment(button.dataset.deleteComment, button);
});
$('#preview-dialog').addEventListener('close', function () {
  $('#preview-stage').innerHTML = '';
  state.previewPost = null;
});

supabase.auth.onAuthStateChange(function (event, session) {
  state.user = session ? session.user : null;
  updateAuthUI();
  if (!state.user) {
    state.myProfile = null;
    updateAuthUI();
  }
  if (['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT', 'PASSWORD_RECOVERY', 'USER_UPDATED'].includes(event)) {
    window.setTimeout(async function () {
      loadPosts();
      if (state.user) {
        cleanupOrphanedMediaObjects();
        try {
          await loadMyProfile();
          await cleanupOrphanedAvatarObjects();
        } catch (error) {
          console.warn('Could not load signed-in profile or clean up avatar Storage:', error);
        }
      }
      if (state.postPagePost) loadPostComments(state.postPagePost.id);
      if (state.profilePageId) openProfilePage(state.profilePageId);
    }, 0);
  }
  if (event === 'PASSWORD_RECOVERY') {
    openAuth('update');
  }
});

function setCommentMessage(message, isError) {
  const el = $('#comment-message');
  if (!el) return;
  el.textContent = message || '';
  el.hidden = !message;
  el.classList.toggle('is-error', Boolean(message && isError));
}

function renderCommentComposer() {
  const prompt = $('#comments-auth-prompt');
  const form = $('#comment-form');
  if (!prompt || !form) return;
  const hasPost = Boolean(state.postPagePost);
  prompt.hidden = !hasPost || Boolean(state.user);
  form.hidden = !hasPost || !state.user;
  if (!hasPost) return;
  if (state.user && $('#comment-body') && !state.commentSubmitting) {
    $('#comment-submit').disabled = false;
  }
}

function renderComments(comments) {
  const list = $('#comments-list');
  const count = $('#comments-count');
  if (!list || !count) return;

  count.textContent = comments.length === 1 ? '1 comment' : comments.length + ' comments';
  list.replaceChildren();

  if (!comments.length) {
    const empty = document.createElement('p');
    empty.className = 'comments-empty';
    empty.textContent = 'No comments yet. Start the conversation.';
    list.appendChild(empty);
    return;
  }

  comments.forEach(function (comment) {
    const item = document.createElement('article');
    item.className = 'comment-item';

    const header = document.createElement('div');
    header.className = 'comment-item-header';

    const identity = document.createElement('div');
    identity.className = 'comment-identity';

    const profile = state.profilesById[comment.user_id] || null;
    const displayName = profile?.display_name || 'Member';

    const avatar = document.createElement('span');
    avatar.className = 'comment-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    if (profile?.avatar_path) {
      const image = document.createElement('img');
      image.src = getAvatarUrl(profile.avatar_path);
      image.alt = '';
      image.loading = 'lazy';
      avatar.appendChild(image);
    } else {
      avatar.textContent = getInitials(displayName);
    }

    const author = document.createElement('a');
    author.className = 'comment-author';
    author.href = getProfileUrl(comment.user_id);
    author.textContent = displayName;
    author.title = 'View ' + displayName + "'s profile";

    const time = document.createElement('time');
    time.className = 'comment-time';
    time.dateTime = comment.created_at;
    time.textContent = formatDate(comment.created_at);

    identity.append(avatar, author);
    header.append(identity, time);

    if (state.user && state.user.id === comment.user_id) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'comment-delete';
      remove.dataset.deleteComment = comment.id;
      remove.textContent = 'Delete';
      remove.setAttribute('aria-label', 'Delete your comment');
      header.appendChild(remove);
    }

    const body = document.createElement('p');
    body.className = 'comment-body';
    body.textContent = comment.body;

    item.append(header, body);
    list.appendChild(item);
  });
}

async function loadPostComments(postId) {
  const list = $('#comments-list');
  const count = $('#comments-count');
  if (!postId || !list || !count) return;

  count.textContent = 'Loading…';
  list.innerHTML = '<p class="comments-empty">Loading comments…</p>';

  try {
    const result = await supabase.from('post_comments')
      .select('id,post_id,user_id,body,created_at')
      .eq('post_id', postId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (result.error) throw result.error;
    if (!state.postPagePost || state.postPagePost.id !== postId) return;
    state.postComments = result.data || [];
    try {
      await loadProfiles(state.postComments.map(function (comment) { return comment.user_id; }));
    } catch (profileError) {
      console.warn('Could not load commenter profiles:', profileError);
    }
    renderComments(state.postComments);
    setCommentMessage('', false);
  } catch (error) {
    console.error('Could not load comments:', error);
    count.textContent = 'Comments unavailable';
    list.innerHTML = '<p class="comments-empty">Comments could not load. Please refresh the page and try again.</p>';
  }
}

async function submitPostComment(event) {
  event.preventDefault();
  const post = state.postPagePost;
  const user = state.user;
  const bodyField = $('#comment-body');
  const button = $('#comment-submit');
  const body = bodyField.value.trim();

  if (!post) return;
  if (!user) {
    openAuth('signin');
    return;
  }
  if (!body) {
    setCommentMessage('Write a comment before posting.', true);
    return;
  }
  if (body.length > 1000) {
    setCommentMessage('Comments must be 1,000 characters or fewer.', true);
    return;
  }

  state.commentSubmitting = true;
  button.disabled = true;
  button.textContent = 'Posting…';
  setCommentMessage('', false);

  try {
    const result = await supabase.from('post_comments').insert({
      post_id: post.id,
      user_id: user.id,
      body: body
    });
    if (result.error) throw result.error;

    bodyField.value = '';
    $('#comment-char-count').textContent = '0/1000';
    showToast('Comment posted.');
    await loadPostComments(post.id);
  } catch (error) {
    console.error('Could not post comment:', error);
    setCommentMessage(error.message || 'Your comment could not be posted. Please try again.', true);
  } finally {
    state.commentSubmitting = false;
    button.disabled = false;
    button.textContent = 'Post comment ↗';
  }
}

async function deletePostComment(commentId, button) {
  const comment = state.postComments.find(function (item) { return item.id === commentId; });
  if (!comment || !state.user || comment.user_id !== state.user.id) return;
  if (!window.confirm('Delete your comment?')) return;

  button.disabled = true;
  button.textContent = 'Deleting…';
  try {
    const result = await supabase.from('post_comments')
      .delete()
      .eq('id', commentId)
      .eq('user_id', state.user.id);
    if (result.error) throw result.error;
    showToast('Comment deleted.');
    if (state.postPagePost) await loadPostComments(state.postPagePost.id);
  } catch (error) {
    console.error('Could not delete comment:', error);
    setCommentMessage(error.message || 'Your comment could not be deleted.', true);
    button.disabled = false;
    button.textContent = 'Delete';
  }
}

async function openPostPage(postId) {
  const homeView = $('#home-view');
  const page = $('#post-page');
  const message = $('#post-page-message');
  const detail = $('#post-detail');
  homeView.hidden = true;
  page.hidden = false;
  detail.hidden = true;
  message.hidden = false;
  message.textContent = 'Loading post…';

  if (!postId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(postId)) {
    message.textContent = 'That post link does not look valid. Head back to the gallery to find something else.';
    document.title = 'Post not found — imgifvid';
    return;
  }

  try {
    const result = await supabase.from('media_posts')
      .select('id,user_id,title,description,storage_path,original_name,mime_type,media_kind,file_size_bytes,created_at')
      .eq('id', postId)
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) {
      message.textContent = 'This post may have been deleted, or the link may be incorrect.';
      document.title = 'Post not found — imgifvid';
      return;
    }

    const post = result.data;
    state.postPagePost = post;
    state.postComments = [];
    renderCommentComposer();
    const title = post.title || titleFromFilename(post.original_name);
    const url = getPublicUrl(post.storage_path);
    const kindLabel = post.media_kind === 'gif' ? 'GIF' : post.media_kind === 'video' ? 'VIDEO' : 'IMAGE';

    $('#post-page-kind').textContent = kindLabel + ' / IMGIFVID POST';
    $('#post-detail-type').textContent = 'FROM THE COMMUNITY / ' + kindLabel;
    $('#post-page-title').textContent = title;
    $('#post-page-description').textContent = post.description || '';
    $('#post-page-description').hidden = !post.description;
    $('#post-page-date').textContent = 'Posted ' + formatDate(post.created_at);
    $('#post-page-size').textContent = formatBytes(Number(post.file_size_bytes) || 0);
    $('#post-page-original').href = url;
    $('#post-page-delete').hidden = !(state.user && state.user.id === post.user_id);
    $('#post-page-message').hidden = true;
    $('#post-detail').hidden = false;

    const media = $('#post-detail-media');
    media.innerHTML = '';
    if (post.media_kind === 'video') {
      const video = document.createElement('video');
      video.src = url;
      video.controls = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.setAttribute('aria-label', title);
      media.appendChild(video);
    } else {
      const image = document.createElement('img');
      image.src = url;
      image.alt = title;
      image.decoding = 'async';
      media.appendChild(image);
    }

    document.title = title + ' — imgifvid';
    const descriptionMeta = document.querySelector('meta[name="description"]');
    if (descriptionMeta) {
      descriptionMeta.content = (post.description || 'View this ' + post.media_kind + ' post on imgifvid.').slice(0, 250);
    }
    await loadPostComments(post.id);
  } catch (error) {
    console.error('Could not load post page:', error);
    message.textContent = 'We could not load this post right now. Please try again, or return to the gallery.';
    document.title = 'Post unavailable — imgifvid';
  }
}

function renderProfilePosts(posts) {
  const grid = $('#profile-posts-grid');
  const empty = $('#profile-empty-posts');
  grid.replaceChildren();
  $('#profile-page-post-count').textContent = posts.length === 1 ? '1 post' : posts.length + ' posts';
  if (!posts.length) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  posts.forEach(function (post, index) {
    const url = getPublicUrl(post.storage_path);
    const title = post.title || titleFromFilename(post.original_name);
    const kindLabel = post.media_kind === 'gif' ? 'GIF' : post.media_kind === 'video' ? 'Video' : 'Image';
    const card = document.createElement('article');
    card.className = 'media-card';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', 'Open ' + title);
    card.style.animationDelay = Math.min(index * 35, 280) + 'ms';
    const mediaElement = post.media_kind === 'video'
      ? '<video src="' + escapeHTML(url) + '" muted playsinline preload="metadata" aria-label="' + escapeHTML(title) + ' preview"></video><span class="video-play" aria-hidden="true">▶</span>'
      : '<img src="' + escapeHTML(url) + '" loading="lazy" alt="' + escapeHTML(title) + '">';
    card.innerHTML =
      '<div class="media-preview">' + mediaElement + '<span class="media-tag">' + kindLabel + '</span></div>' +
      '<div class="media-card-body"><h3 class="media-card-title">' + escapeHTML(title) + '</h3>' +
      '<p class="media-card-description">' + escapeHTML(post.description || '') + '</p>' +
      '<div class="media-card-footer"><span>' + formatDate(post.created_at) + '</span><span>Open post ↗</span></div></div>';
    card.addEventListener('click', function () { window.location.assign(getPostUrl(post.id)); });
    card.addEventListener('keydown', function (event) {
      if (event.target === card && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        window.location.assign(getPostUrl(post.id));
      }
    });
    grid.appendChild(card);
  });
}

async function openProfilePage(profileId) {
  state.profilePageId = profileId;
  $('#home-view').hidden = true;
  $('#post-page').hidden = true;
  $('#profile-page').hidden = false;
  $('#profile-content').hidden = true;
  const message = $('#profile-page-message');
  message.hidden = false;
  message.textContent = 'Loading profile…';

  if (!profileId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(profileId)) {
    message.textContent = 'That profile link does not look valid. Return to the gallery to find a member.';
    document.title = 'Profile not found — imgifvid';
    return;
  }

  try {
    const result = await supabase.from('profiles')
      .select('id,display_name,bio,avatar_path,created_at,updated_at')
      .eq('id', profileId)
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) {
      message.textContent = 'This profile could not be found.';
      document.title = 'Profile not found — imgifvid';
      return;
    }

    const profile = result.data;
    state.profilesById[profile.id] = profile;
    const isOwner = Boolean(state.user && state.user.id === profile.id);
    if (isOwner) state.myProfile = profile;

    const displayName = profile.display_name || 'Member';
    $('#profile-page-name').textContent = displayName;
    $('#profile-page-bio').textContent = profile.bio || '';
    $('#profile-page-bio').hidden = !profile.bio;
    $('#profile-page-joined').textContent = 'Member since ' + formatDate(profile.created_at);
    $('#profile-share').textContent = 'Share profile ↗';
    $('#profile-editor-section').hidden = !isOwner;

    const avatarImage = $('#profile-page-avatar');
    const avatarFallback = $('#profile-page-avatar-fallback');
    $('#profile-avatar-remove').hidden = !isOwner || !profile.avatar_path;
    if (profile.avatar_path) {
      avatarImage.src = getAvatarUrl(profile.avatar_path);
      avatarImage.alt = displayName + "'s profile picture";
      avatarImage.hidden = false;
      avatarFallback.hidden = true;
    } else {
      avatarImage.removeAttribute('src');
      avatarImage.alt = '';
      avatarImage.hidden = true;
      avatarFallback.textContent = getInitials(displayName);
      avatarFallback.hidden = false;
    }

    if (isOwner) {
      $('#profile-display-name').value = profile.display_name || '';
      $('#profile-bio').value = profile.bio || '';
      $('#profile-avatar-input').value = '';
      setProfileFormMessage('', false);
    }

    const postsResult = await supabase.from('media_posts')
      .select('id,user_id,title,description,storage_path,original_name,mime_type,media_kind,file_size_bytes,created_at')
      .eq('user_id', profileId)
      .order('created_at', { ascending: false })
      .limit(90);
    if (postsResult.error) throw postsResult.error;

    message.hidden = true;
    $('#profile-content').hidden = false;
    renderProfilePosts(postsResult.data || []);
    document.title = displayName + ' — imgifvid';
    const descriptionMeta = document.querySelector('meta[name="description"]');
    if (descriptionMeta) descriptionMeta.content = (profile.bio || displayName + "'s profile on imgifvid.").slice(0, 250);
    if (isOwner) updateAuthUI();
  } catch (error) {
    console.error('Could not load profile:', error);
    message.textContent = 'We could not load this profile right now. Please try again.';
    document.title = 'Profile unavailable — imgifvid';
  }
}

function setProfileFormMessage(message, isError) {
  const element = $('#profile-form-message');
  element.textContent = message || '';
  element.hidden = !message;
  element.classList.toggle('is-error', Boolean(message && isError));
}

async function saveProfile(event) {
  event.preventDefault();
  if (!state.user || state.savingProfile) return;

  const displayName = $('#profile-display-name').value.trim();
  const bio = $('#profile-bio').value.trim();
  const avatarFile = $('#profile-avatar-input').files[0] || null;
  if (!displayName || displayName.length > 32) {
    setProfileFormMessage('Display names must be between 1 and 32 characters.', true);
    return;
  }
  if (bio.length > 280) {
    setProfileFormMessage('Your bio must be 280 characters or fewer.', true);
    return;
  }

  let newAvatarPath = null;
  const oldAvatarPath = state.myProfile?.avatar_path || null;
  let profileSaved = false;
  let avatarCleanupError = null;
  const button = $('#profile-save');
  state.savingProfile = true;
  button.disabled = true;
  button.textContent = 'Saving…';
  $('#profile-avatar-remove').disabled = true;
  setProfileFormMessage('', false);

  try {
    if (avatarFile) {
      const allowed = new Set(['image/jpeg','image/png','image/webp','image/avif','image/gif']);
      if (!allowed.has(avatarFile.type.toLowerCase())) {
        throw new Error('Choose a JPG, PNG, WebP, AVIF, or GIF image.');
      }
      if (avatarFile.size <= 0 || avatarFile.size > 5 * 1024 * 1024) {
        throw new Error('Profile pictures must be smaller than 5 MB.');
      }
      const extension = (avatarFile.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
      newAvatarPath = state.user.id + '/' + crypto.randomUUID() + '.' + (extension || 'png');
      const upload = await supabase.storage.from('avatars').upload(newAvatarPath, avatarFile, {
        cacheControl: '3600',
        contentType: avatarFile.type,
        upsert: false
      });
      if (upload.error) throw upload.error;
    }

    const updates = {
      id: state.user.id,
      display_name: displayName,
      bio: bio,
      avatar_path: newAvatarPath || oldAvatarPath,
      updated_at: new Date().toISOString()
    };
    const result = await supabase.from('profiles').upsert(updates)
      .select('id,display_name,bio,avatar_path,created_at,updated_at')
      .single();
    if (result.error) throw result.error;

    profileSaved = true;
    state.myProfile = result.data;
    state.profilesById[result.data.id] = result.data;
    updateAuthUI();

    // The new photo is now live. Verify that the replaced file is actually gone;
    // don't delete the new photo if cleanup of the previous one fails.
    if (newAvatarPath && oldAvatarPath && oldAvatarPath !== newAvatarPath) {
      try {
        await removeAvatarObjectAndVerify(oldAvatarPath);
      } catch (error) {
        avatarCleanupError = error;
        console.error('Could not remove the replaced profile picture:', error);
      }
    }

    if (state.avatarPreviewUrl) {
      URL.revokeObjectURL(state.avatarPreviewUrl);
      state.avatarPreviewUrl = null;
    }
    await openProfilePage(state.user.id);
    if (avatarCleanupError) {
      setProfileFormMessage(
        'Profile saved, but the previous photo could not be removed from Storage. It will be retried during cleanup. ' +
        (avatarCleanupError.message || ''),
        true
      );
      showToast('Profile saved, but old photo cleanup failed.');
    } else {
      showToast('Profile saved.');
    }
  } catch (error) {
    console.error('Could not save profile:', error);
    if (newAvatarPath && !profileSaved) {
      try {
        await removeAvatarObjectAndVerify(newAvatarPath);
      } catch (cleanupError) {
        console.warn('Could not clean up failed profile picture upload:', cleanupError);
      }
    }
    setProfileFormMessage(error.message || 'Your profile could not be saved. Please try again.', true);
  } finally {
    state.savingProfile = false;
    button.disabled = false;
    button.textContent = 'Save profile ↗';
    $('#profile-avatar-remove').disabled = false;
  }
}

async function removeProfilePhoto() {
  if (!state.user || state.savingProfile) return;
  const ownerId = state.user.id;
  const oldAvatarPath = state.myProfile?.avatar_path || null;
  if (!oldAvatarPath) {
    showToast('You do not have a saved profile photo to remove.');
    return;
  }
  if (!window.confirm('Remove your profile photo? The image file will also be deleted from Storage.')) return;

  const saveButton = $('#profile-save');
  const removeButton = $('#profile-avatar-remove');
  state.savingProfile = true;
  saveButton.disabled = true;
  removeButton.disabled = true;
  removeButton.textContent = 'Removing…';
  setProfileFormMessage('', false);

  try {
    // Clear the public profile reference first. If Storage deletion fails, restore
    // the reference so the profile does not unexpectedly lose its current image.
    const cleared = await supabase.from('profiles')
      .update({ avatar_path: null, updated_at: new Date().toISOString() })
      .eq('id', ownerId)
      .select('id,display_name,bio,avatar_path,created_at,updated_at')
      .single();
    if (cleared.error) throw cleared.error;

    state.myProfile = cleared.data;
    state.profilesById[ownerId] = cleared.data;
    updateAuthUI();

    try {
      await removeAvatarObjectAndVerify(oldAvatarPath);
    } catch (storageError) {
      console.error('Could not remove profile picture from Storage:', storageError);
      const restored = await supabase.from('profiles')
        .update({ avatar_path: oldAvatarPath, updated_at: new Date().toISOString() })
        .eq('id', ownerId)
        .select('id,display_name,bio,avatar_path,created_at,updated_at')
        .single();

      if (!restored.error && restored.data) {
        state.myProfile = restored.data;
        state.profilesById[ownerId] = restored.data;
        updateAuthUI();
        await openProfilePage(ownerId);
        setProfileFormMessage(
          'The photo was kept because Storage did not confirm deletion. Please retry. ' +
          (storageError.message || ''),
          true
        );
        showToast('Could not remove profile photo.');
        return;
      }

      console.error('Could not restore the profile picture reference after Storage cleanup failed:', restored.error);
      // The profile reference is already cleared. Keep the UI honest, and report
      // that file cleanup still needs attention instead of pretending it succeeded.
      if (state.avatarPreviewUrl) {
        URL.revokeObjectURL(state.avatarPreviewUrl);
        state.avatarPreviewUrl = null;
      }
      $('#profile-avatar-input').value = '';
      await openProfilePage(ownerId);
      setProfileFormMessage(
        'The photo is no longer displayed, but Storage could not confirm deleting its file. Please try again. ' +
        (storageError.message || ''),
        true
      );
      showToast('Profile photo cleared, but Storage cleanup needs a retry.');
      return;
    }

    if (state.avatarPreviewUrl) {
      URL.revokeObjectURL(state.avatarPreviewUrl);
      state.avatarPreviewUrl = null;
    }
    $('#profile-avatar-input').value = '';
    await openProfilePage(ownerId);
    showToast('Profile photo removed from your profile and Storage.');
  } catch (error) {
    console.error('Could not remove profile picture:', error);
    setProfileFormMessage(error.message || 'Your profile picture could not be removed. Please try again.', true);
  } finally {
    state.savingProfile = false;
    saveButton.disabled = false;
    removeButton.disabled = false;
    removeButton.textContent = 'Remove profile photo';
  }
}
async function boot() {
  const result = await supabase.auth.getSession();
  state.user = result.data && result.data.session ? result.data.session.user : null;
  updateAuthUI();
  if (state.user) {
    try { await loadMyProfile(); } catch (error) { console.warn('Could not load signed-in profile:', error); }
  }
  renderQueue();
  await loadPosts();
  const params = new URLSearchParams(window.location.search);
  const postId = params.get('post');
  const profileId = params.get('profile');
  if (postId) {
    await openPostPage(postId);
  } else if (profileId) {
    await openProfilePage(profileId);
  }
  if (params.has('reset-password')) {
    openAuth('update');
  }
}

boot().catch(function (error) {
  console.error('App initialization failed:', error);
  showFeedMessage('The app could not finish initializing. Refresh the page and try again.');
});