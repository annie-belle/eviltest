(function () {
    "use strict";

    var metro = vendetta.metro;
    var common = metro.common;
    var React = common.React;
    var RN = common.ReactNative;
    var after = vendetta.patcher.after;
    var storage = vendetta.plugin.storage;
    var useProxy = vendetta.storage.useProxy;
    var Forms = vendetta.ui.components.Forms;

    if (typeof storage.hiddenIds !== "string") storage.hiddenIds = "";

    var ChannelStore = metro.findByStoreName("ChannelStore");
    var PrivateChannelSortStore = metro.findByStoreName("PrivateChannelSortStore");
    var FluxDispatcher = common.FluxDispatcher;
    var PrivateChannelActions = metro.findByProps("closePrivateChannel");

    // While true, our list patches step aside so we can see the real, unfiltered DM list
    var bypass = false;

    function hiddenIds() {
        return storage.hiddenIds.split(",")
            .map(function (s) { return s.trim(); })
            .filter(function (s) { return s.length > 0; });
    }

    // True if this is a 1-on-1 DM (type 1) with someone on the hidden list
    function isHidden(item) {
        try {
            var channel = item;
            if (typeof item === "string") channel = ChannelStore.getChannel(item);
            else if (item && item.channelId && !item.recipients) channel = ChannelStore.getChannel(item.channelId);
            if (!channel || channel.type !== 1 || !channel.recipients) return false;
            var ids = hiddenIds();
            return channel.recipients.some(function (id) { return ids.indexOf(id) !== -1; });
        } catch (e) {
            return false;
        }
    }

    // Removes hidden DMs from whatever list shape Discord returns
    function filterList(list) {
        if (bypass || !Array.isArray(list)) return list;
        return list
            .filter(function (item) { return Array.isArray(item) || !isHidden(item); })
            .map(function (item) { return Array.isArray(item) ? filterList(item) : item; });
    }

    var unpatches = [];
    var timers = [];
    var closedThisSession = {}; // so the same DM isn't closed twice in one launch

    function allPrivateChannels() {
        bypass = true;
        try {
            if (typeof ChannelStore.getSortedPrivateChannels === "function") {
                return ChannelStore.getSortedPrivateChannels() || [];
            }
            var map = (typeof ChannelStore.getMutablePrivateChannels === "function")
                ? ChannelStore.getMutablePrivateChannels() : {};
            return Object.keys(map || {}).map(function (k) { return map[k]; });
        } finally {
            bypass = false;
        }
    }

    // Closes each open DM with a hidden user, half a second apart to go easy on Discord's servers
    function closeHiddenDMs() {
        if (!PrivateChannelActions || typeof PrivateChannelActions.closePrivateChannel !== "function") return 0;
        var toClose = allPrivateChannels().filter(function (ch) {
            return isHidden(ch) && !closedThisSession[ch.id];
        });
        toClose.forEach(function (channel, i) {
            closedThisSession[channel.id] = true;
            timers.push(setTimeout(function () {
                try { PrivateChannelActions.closePrivateChannel(channel.id); } catch (e) {}
            }, i * 500));
        });
        return toClose.length;
    }

    // Channel data usually isn't loaded yet when plugins start, so run again once Discord connects
    function onConnectionOpen() {
        timers.push(setTimeout(closeHiddenDMs, 2000));
    }

    function patch(store, method) {
        if (store && typeof store[method] === "function") {
            unpatches.push(after(method, store, function (_args, ret) {
                try { return filterList(ret); } catch (e) { return ret; }
            }));
        }
    }

    function SettingsPage() {
        useProxy(storage);
        return React.createElement(RN.ScrollView, { style: { flex: 1 } },
            React.createElement(Forms.FormSection, { title: "Hidden users" },
                React.createElement(Forms.FormInput, {
                    title: "User IDs (comma-separated)",
                    placeholder: "123456789012345678, 876543210987654321",
                    value: storage.hiddenIds,
                    onChange: function (v) { storage.hiddenIds = v; }
                }),
                React.createElement(Forms.FormRow, {
                    label: "Close their DMs now",
                    subLabel: "Also happens automatically every time Discord starts",
                    onPress: function () { closedThisSession = {}; closeHiddenDMs(); }
                }),
                React.createElement(Forms.FormText, { style: { padding: 16 } },
                    "Fully close and reopen Discord after changing the IDs so the list updates.")
            )
        );
    }

    return {
        onLoad: function () {
            patch(PrivateChannelSortStore, "getPrivateChannelIds");
            patch(PrivateChannelSortStore, "getSortedChannels");
            patch(ChannelStore, "getSortedPrivateChannels");
            if (FluxDispatcher) FluxDispatcher.subscribe("CONNECTION_OPEN", onConnectionOpen);
            timers.push(setTimeout(closeHiddenDMs, 3000));
        },
        onUnload: function () {
            if (FluxDispatcher) FluxDispatcher.unsubscribe("CONNECTION_OPEN", onConnectionOpen);
            timers.forEach(function (t) { clearTimeout(t); });
            timers = [];
            unpatches.forEach(function (u) { u(); });
            unpatches = [];
        },
        settings: SettingsPage
    };
})()
