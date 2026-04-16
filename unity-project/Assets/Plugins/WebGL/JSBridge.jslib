// JSBridge WebGL plugin — Unity → JavaScript communication

mergeInto(LibraryManager.library, {
    SendToJS: function(msgPtr) {
        var msg = UTF8ToString(msgPtr);
        try {
            var parsed = JSON.parse(msg);
            window.dispatchEvent(new CustomEvent('unity-message', { detail: parsed }));
            console.log('[Unity→JS]', parsed.type, parsed.payload);
        } catch (e) {
            console.error('[Unity→JS] Parse error:', e, msg);
        }
    }
});
