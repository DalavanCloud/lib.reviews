// const activeInputRules = [
//   // Convert -- to —
//   inputRules.emDash,
//   // Convert ... to …
//   inputRules.ellipsis
  // Convert 1. , 2. .. at beginning of line to numbered list
//  inputRules.orderedListRule(markdownSchema.nodes.ordered_list),
  // Convert * or - at beginning of line to bullet list
//  inputRules.wrappingInputRule(/^\s*([-*]) $/, markdownSchema.nodes.bullet_list),
  // Convert > at beginning of line to quote
//  inputRules.blockQuoteRule(markdownSchema.nodes.blockquote),
  // Convert #, ##, .. at beginning of line to heading
//  inputRules.headingRule(markdownSchema.nodes.heading, 6)
// ];

// Adapted from https://github.com/ProseMirror/prosemirror-example-setup

const {
  inputRules,
  wrappingInputRule,
  textblockTypeInputRule,
  smartQuotes,
  emDash,
  ellipsis
} = require('prosemirror-inputrules');

// : (NodeType) → InputRule
// Given a blockquote node type, returns an input rule that turns `"> "`
// at the start of a textblock into a blockquote.
function blockQuoteRule(nodeType) {
  return wrappingInputRule(/^\s*>\s$/, nodeType);
}

// : (NodeType) → InputRule
// Given a list node type, returns an input rule that turns a number
// followed by a dot at the start of a textblock into an ordered list.
function orderedListRule(nodeType) {
  return wrappingInputRule(/^(\d+)\.\s$/, nodeType, match => ({ order: +match[1] }),
    (match, node) => node.childCount + node.attrs.order == +match[1]);
}

// : (NodeType) → InputRule
// Given a list node type, returns an input rule that turns a bullet
// (dash, plush, or asterisk) at the start of a textblock into a
// bullet list.
function bulletListRule(nodeType) {
  return wrappingInputRule(/^\s*([-+*])\s$/, nodeType);
}

// : (NodeType) → InputRule
// Given a code block node type, returns an input rule that turns a
// textblock starting with three backticks into a code block.
function codeBlockRule(nodeType) {
  return textblockTypeInputRule(/^```$/, nodeType);
}

// : (NodeType, number) → InputRule
// Given a node type and a maximum level, creates an input rule that
// turns up to that number of `#` characters followed by a space at
// the start of a textblock into a heading whose level corresponds to
// the number of `#` signs.
function headingRule(nodeType, maxLevel) {
  return textblockTypeInputRule(new RegExp("^(#{1," + maxLevel + "})\\s$"),
    nodeType, match => ({ level: match[1].length }));
}

// : (Schema) → Plugin
// A set of input rules for creating the basic block quotes, lists,
// code blocks, and heading.
exports.buildInputRules = function(schema) {
  let rules = smartQuotes.concat(ellipsis, emDash),
    type;
  if ((type = schema.nodes.blockquote))
    rules.push(blockQuoteRule(type));
  if ((type = schema.nodes.ordered_list))
    rules.push(orderedListRule(type));
  if ((type = schema.nodes.bullet_list))
    rules.push(bulletListRule(type));
  if ((type = schema.nodes.code_block))
    rules.push(codeBlockRule(type));
  if ((type = schema.nodes.heading))
    rules.push(headingRule(type, 6));
  return inputRules({ rules });
};
