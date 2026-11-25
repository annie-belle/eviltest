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
        if (!Array.isArray(list)) return list;
        return list
            .filter(function (item) { return Array.isArray(item) || !isHidden(item); })
            .map(function (item) { return Array.isArray(item) ? filterList(item) : item; });
    }

    var unpatches = [];

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
                React.createElement(Forms.FormText, { style: { padding: 16 } },
                    "Fully close and reopen Discord after changing this.")
            )
        );
    }

    return {
        onLoad: function () {
            patch(PrivateChannelSortStore, "getPrivateChannelIds");
            patch(PrivateChannelSortStore, "getSortedChannels");
            patch(ChannelStore, "getSortedPrivateChannels");
        },
        onUnload: function () {
            unpatches.forEach(function (u) { u(); });
            unpatches = [];
        },
        settings: SettingsPage
    };
})()
