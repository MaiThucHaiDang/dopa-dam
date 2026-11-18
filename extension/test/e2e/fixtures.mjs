// Shared by run.mjs and with-agent.mjs: a stand-in for YouTube and the lecture-mode expectations.
// A stand-in for a YouTube watch page: the same tags, ids and classes lecture mode targets, with some content each.
export const FAKE_WATCH_PAGE = (url) => `<!doctype html><title>Watch</title>
  <style>ytd-masthead,ytd-app,ytd-mini-guide-renderer,tp-yt-app-drawer,ytd-reel-shelf-renderer,ytd-playlist-panel-renderer,
    ytd-watch-next-secondary-results-renderer,ytd-comments,ytd-page-manager,.html5-endscreen,.ytp-ce-element,
    .ytp-autonav-toggle-button-container,.ytp-next-button,#logo,#guide,#related,#secondary,#secondary-inner,#primary,#player,#title,
    #guide-button{display:block;min-height:20px}</style>
  <ytd-app>
    <ytd-masthead><a id="logo" href="/">YouTube</a><button id="guide-button">Menu</button></ytd-masthead>
    <tp-yt-app-drawer id="guide">Guide</tp-yt-app-drawer>
    <ytd-mini-guide-renderer>Mini guide</ytd-mini-guide-renderer>
    <ytd-page-manager>
      <div id="primary">
        <div id="player">Player
          <div class="html5-endscreen">End wall</div><div class="ytp-ce-element">Card</div>
          <div class="ytp-autonav-toggle-button-container">Autoplay</div><div class="ytp-next-button">Next</div></div>
        <h1 id="title">Tiêu đề</h1><h2 id="content">Nội dung giải trí ${url}</h2>
        <ytd-comments id="comments">Bình luận</ytd-comments>
      </div>
      <div id="secondary"><div id="secondary-inner">
        <ytd-playlist-panel-renderer id="playlist">Danh sách phát</ytd-playlist-panel-renderer>
        <div id="related"><ytd-watch-next-secondary-results-renderer>Gợi ý</ytd-watch-next-secondary-results-renderer></div>
        <ytd-reel-shelf-renderer>Shorts</ytd-reel-shelf-renderer>
      </div></div>
    </ytd-page-manager>
  </ytd-app>
  <button id="go-a2" onclick="history.pushState({}, '', '/watch?v=A2'); document.dispatchEvent(new Event('yt-navigate-finish'))">Sang A2</button>`;


export const LECTURE_HIDDEN = [
  "#related", "ytd-watch-next-secondary-results-renderer", ".html5-endscreen", ".ytp-ce-element", "ytd-reel-shelf-renderer",
  "#logo", "#guide-button", "#guide", "ytd-mini-guide-renderer", ".ytp-autonav-toggle-button-container",
];
export const LECTURE_KEPT = ["#player", "#title", "#comments"];

export const LECTURE_NOTE = "Chế độ bài giảng của DopaDam: đã ẩn gợi ý.";
