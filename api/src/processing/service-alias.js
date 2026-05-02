const friendlyNames = {
    bsky: "bluesky",
    twitch: "twitch clips",
    yle: "yle areena"
}

export const friendlyServiceName = (service) => {
    if (service in friendlyNames) {
        return friendlyNames[service];
    }
    return service;
}
