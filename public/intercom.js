(function (window, document) {
  const APP_ID = "gev0e855";
  const SCRIPT_ID = "_intercom_npm_loader";
  const REGION_API = "https://api-iam.intercom.io";

  function loadWidget() {
    if (document.getElementById(SCRIPT_ID)) return;
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.type = "text/javascript";
    script.async = true;
    script.src = "https://widget.intercom.io/widget/" + APP_ID;
    const first = document.getElementsByTagName("script")[0];
    if (first && first.parentNode) first.parentNode.insertBefore(script, first);
    else document.head.appendChild(script);
  }

  function Intercom(props) {
    if (!props || typeof props !== "object") return;
    const settings = Object.assign({ api_base: REGION_API }, props, { app_id: props.app_id || APP_ID });
    window.intercomSettings = settings;
    if (typeof window.Intercom === "function") {
      window.Intercom("boot", settings);
      return;
    }
    const queue = function () {
      queue.q.push(arguments);
    };
    queue.q = [];
    window.Intercom = queue;
    if (document.readyState === "complete" || document.readyState === "interactive") loadWidget();
    else document.addEventListener("DOMContentLoaded", loadWidget);
  }

  Intercom.shutdown = function () {
    if (typeof window.Intercom === "function") window.Intercom("shutdown");
  };

  window.IntercomSDK = Intercom;
})(window, document);
