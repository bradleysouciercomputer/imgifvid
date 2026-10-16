# imgifvid

A static image, GIF, and short-video sharing site for GitHub Pages. The front end is plain HTML, CSS, and JavaScript; Supabase provides email/password authentication, the media-post database, and object storage.

## Features

- Email/password account creation, sign-in, sign-out, and password reset.
- Upload multiple images, animated GIFs, and short videos.
- File queue with local previews, optional title and caption, and upload progress.
- Public gallery with image/GIF/video filters, search, standalone shareable post pages, public comments, direct media links, and deletion of your own posts.
- Responsive layout for desktop and mobile.
- No build step or private server required.

## Publish on GitHub Pages

1. Open the repository **Settings → Pages**.
2. Under **Build and deployment**, set the source to **Deploy from a branch**.
3. Choose branch **main** and folder **/(root)**, then save.
4. GitHub Pages will publish the static files at:

   https://bradleysouciercomputer.github.io/imgifvid/

GitHub Pages publishes static files from the selected branch and folder. See the [GitHub Pages publishing-source guide](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

## Configure Supabase Auth redirects

The app already uses the existing imgifvid Supabase project URL and its public publishable key in app.js. Publishable keys are intended for browser applications; never put a Supabase secret key or service-role key in this repository.

In Supabase, open **Authentication → URL Configuration** and set:

- **Site URL:** https://bradleysouciercomputer.github.io/imgifvid/
- **Additional Redirect URLs:** add https://bradleysouciercomputer.github.io/imgifvid/

You may also add your local test URL, such as http://127.0.0.1:5500/**, while developing. If email confirmation is enabled for sign-ups, users must click the confirmation link before they can sign in.

## Supabase setup

The schema and policies in supabase-setup.sql have already been applied to the configured imgifvid project. The SQL file is kept here for reference/reproducibility.

The setup creates:

- public.media_posts with row-level security enabled.
- A public media Storage bucket restricted to supported image/video MIME types and 100 MB per file.
- Public read access to gallery metadata.
- Authenticated-only post creation and ownership-checked deletion.
- Storage rules that limit uploads/deletes to the signed-in user's own folder.

## Shareable post pages

Each media post has its own imgifvid detail page. Opening a gallery card navigates to the post page, and the Share action copies an imgifvid URL in this format:

`https://bradleysouciercomputer.github.io/imgifvid/?post=<post-id>`

This query-based route works with GitHub Pages static hosting and can be opened directly by anyone. The detail page shows the media, title, caption, upload date and file size, with actions to copy the post link or open the original file. Authenticated owners also see a delete action.

## Comments

Every post page has a public comment thread. Visitors can read comments; signed-in users can add comments up to 1,000 characters and delete their own comments. Row-level security prevents users from posting as another user. Comments are linked to their post and are removed automatically when the post is deleted.

## Public media notice

This is a **public sharing gallery**. Files uploaded to the media bucket are publicly retrievable by URL, and gallery post metadata is visible to everyone. Do not upload private documents, sensitive photos, or anything you do not have permission to share. Deleting a post removes the media object and its gallery row.

The app checks video length in the browser and accepts videos up to 60 seconds. Because this is a static client-side app, that duration check is a user-interface safeguard rather than server-side video transcoding/validation. The Supabase Storage bucket independently enforces the 100 MB limit and allowed MIME types.

## Local testing

Open the project through a local static server rather than relying on a file URL. For example, with Python installed, run python -m http.server 5500 from the repository folder and visit http://127.0.0.1:5500/. Add that URL to Supabase's redirect allow-list if you test password recovery or confirmation locally.

## Files

- index.html — page structure and accessible dialogs.
- styles.css — responsive dark theme and components.
- app.js — Supabase auth, upload queue, media gallery, sharing, and delete logic.
- supabase-setup.sql — database, bucket, and policy definitions.
- favicon.svg — site icon.
- .nojekyll — tells GitHub Pages not to run Jekyll processing.