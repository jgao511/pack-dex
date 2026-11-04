export const ANNIVERSARY_PICKER_GROUP = "30th Anniversary";

export function getSetPickerGroup(set) {
  return set.id === "30th-celebration" ? ANNIVERSARY_PICKER_GROUP : set.era || "Other";
}

export function prioritizeAnniversary([left], [right]) {
  return Number(right === ANNIVERSARY_PICKER_GROUP) - Number(left === ANNIVERSARY_PICKER_GROUP);
}

export function getSetPickerGroupTitle(group) {
  return group === ANNIVERSARY_PICKER_GROUP ? group : `${group} Era`;
}
