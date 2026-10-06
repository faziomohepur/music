// Worker API: tự list file MP3 từ R2 bucket
// Trả về JSON danh sách bài hát cho HTML player

export interface Env {
  MUSIC_BUCKET: R2Bucket;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // GET /api/songs → list MP3 from R2
    if (url.pathname === "/api/songs") {
      const listed = await env.MUSIC_BUCKET.list();

      const songs = listed.objects
        .filter((obj) => obj.key.toLowerCase().endsWith(".mp3"))
        .map((obj, index) => {
          const title = obj.key
            .replace(/\.mp3$/i, "")
            .replace(/[-_]/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase());

          return {
            id: index,
            title,
            file: obj.key,
            size: obj.size,
            url: `/api/play/${encodeURIComponent(obj.key)}`,
          };
        });

      return new Response(JSON.stringify({ songs }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // GET /api/play/:filename → stream MP3
    const playMatch = url.pathname.match(/^\/api\/play\/(.+)$/);
    if (playMatch) {
      const key = decodeURIComponent(playMatch[1]);
      const object = await env.MUSIC_BUCKET.get(key);

      if (!object) {
        return new Response("File not found", { status: 404, headers: corsHeaders });
      }

      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("Content-Type", "audio/mpeg");
      headers.set("Accept-Ranges", "bytes");
      headers.set("Access-Control-Allow-Origin", "*");

      const range = request.headers.get("Range");
      if (range) {
        const matches = range.match(/bytes=(\d+)-(\d+)?/);
        if (matches) {
          const start = parseInt(matches[1], 10);
          const end = matches[2] ? parseInt(matches[2], 10) : object.size - 1;
          const length = end - start + 1;

          headers.set("Content-Range", `bytes ${start}-${end}/${object.size}`);
          headers.set("Content-Length", length.toString());

          return new Response(object.getRange(start, length), { status: 206, headers });
        }
      }

      headers.set("Content-Length", object.size.toString());
      return new Response(object.body, { headers });
    }

    // GET / → HTML player
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(HTML_PAGE, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Not found", { status: 404, headers: corsHeaders });
  },
};

const HTML_PAGE = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🎵 Music Player</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', sans-serif; background: #0f0f1a; color: #fff; min-height: 100vh; display: flex; justify-content: center; align-items: center; padding: 20px; }
    .container { width: 100%; max-width: 480px; background: #1a1a2e; border-radius: 20px; padding: 30px; box-shadow: 0 20px 60px rgba(0,0,0,0.5); }
    h2 { text-align: center; margin-bottom: 20px; font-size: 1.5em; }
    .now-playing { text-align: center; color: #e94560; margin: 15px 0; font-size: 1.1em; min-height: 1.5em; }
    .playlist { list-style: none; max-height: 300px; overflow-y: auto; margin: 15px 0; }
    .playlist li { padding: 14px 18px; margin: 8px 0; background: #16213e; border-radius: 10px; cursor: pointer; transition: all 0.2s; display: flex; justify-content: space-between; align-items: center; }
    .playlist li:hover { background: #0f3460; transform: translateX(4px); }
    .playlist li.active { background: #e94560; }
    .playlist li.active:hover { background: #c73e54; }
    .song-size { font-size: 0.8em; opacity: 0.6; }
    audio { width: 100%; margin-top: 15px; }
    .loading { text-align: center; color: #888; padding: 20px; }
    .empty { text-align: center; color: #888; padding: 20px; }
    .playlist::-webkit-scrollbar { width: 6px; }
    .playlist::-webkit-scrollbar-track { background: #16213e; border-radius: 10px; }
    .playlist::-webkit-scrollbar-thumb { background: #e94560; border-radius: 10px; }
  </style>
</head>
<body>
  <div class="container">
    <h2>🎵 Music Player</h2>
    <div class="now-playing" id="nowPlaying">Đang tải danh sách...</div>
    <ul class="playlist" id="playlist"><li class="loading">⏳ Đang tải...</li></ul>
    <audio id="audio" controls></audio>
  </div>
  <script>
    let songs = [], currentIndex = -1;
    const playlist = document.getElementById('playlist');
    const audio = document.getElementById('audio');
    const nowPlaying = document.getElementById('nowPlaying');

    async function loadSongs() {
      try {
        const res = await fetch('/api/songs');
        const data = await res.json();
        songs = data.songs || [];
        if (songs.length === 0) {
          playlist.innerHTML = '<li class="empty">Chưa có file MP3 nào trong R2</li>';
          nowPlaying.textContent = 'Chưa có bài hát';
          return;
        }
        renderPlaylist();
        nowPlaying.textContent = 'Chọn một bài hát để phát';
      } catch (err) {
        playlist.innerHTML = '<li class="empty">❌ Lỗi tải danh sách</li>';
        nowPlaying.textContent = 'Lỗi kết nối';
      }
    }

    function renderPlaylist() {
      playlist.innerHTML = '';
      songs.forEach((song, i) => {
        const li = document.createElement('li');
        li.innerHTML = '<span>' + song.title + '</span><span class="song-size">' + formatSize(song.size) + '</span>';
        li.addEventListener('click', () => playSong(i));
        playlist.appendChild(li);
      });
    }

    let userInteracted = false;

	function playSong(index) {
	  currentIndex = index;
	  const song = songs[index];
	  audio.src = song.url;
	  nowPlaying.textContent = 'Đang phát: ' + song.title;

	  document.querySelectorAll('.playlist li').forEach((li, i) => {
		li.classList.toggle('active', i === index);
	  });

	  // play() trả về Promise — có thể bị browser chặn nếu chưa có tương tác
	  audio.play().catch(() => {
		if (!userInteracted) {
		  nowPlaying.textContent = '👆 Bấm play để nghe: ' + song.title;
		}
	  });
	}


    function formatSize(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / 1048576).toFixed(1) + ' MB';
    }

		// Tự phát bài tiếp theo khi kết thúc
	audio.addEventListener('ended', () => {
	  if (currentIndex < songs.length - 1) {
		playSong(currentIndex + 1);
	  }
	});

	// Đánh dấu đã có tương tác — sau click đầu tiên browser cho phép autoplay
	document.addEventListener('click', () => { userInteracted = true; }, { once: true });

	// Khởi động
	loadSongs();

  </script>
</body>
</html>`;
