// Every sentence of browsing notes by topic and of changing a note's topics. Copy is fixed; the
// names come from the hive's topics.

/** The name of the switch between the folder column and the topic column. */
export const SWITCH = "Browse notes by";
export const BY_FOLDERS = "Folders";
export const BY_TOPICS = "Topics";

export const ALL_NOTES = "All notes";
export const NO_TOPIC = "No topic";

/** The name of the open note's topics: its chips, + Topic and the picker. */
export const TOPICS_HEADING = "Topics";
/** The name of the picker's popover. */
export const ADD_TOPIC = "Add topic";
export const ADD_TOPIC_BUTTON = "+ Topic";
export const FIND_TOPIC = "Find a topic";
export const NO_TOPIC_MATCHES = "No topic matches.";

/** The name of a chip's Remove button. */
export const removeName = (name: string) => `Remove ${name}`;

/** Announced after a change. */
export const removed = (name: string) => `Removed from ${name}.`;
export const added = (name: string) => `Added to ${name}.`;

export const REFUSED_FULL = "A note has at most five topics. Remove one first.";
export const REFUSED = "That didn't work. Try again.";
