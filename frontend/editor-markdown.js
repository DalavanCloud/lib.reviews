/* global libreviews */
'use strict';

// For parsing markdown
const MarkdownIt = require('markdown-it');

// For custom ::: fenced elements (spoiler warnings, NSFW warnings, etc.)
const container = require('markdown-it-container');

// For HTML5 video/audio support via ![description](filename.webm)
const { html5Media } = require('markdown-it-html5-media');

// Provides ProseMirror integration with default schema
const {
  MarkdownParser,
  schema,
  defaultMarkdownParser,
  defaultMarkdownSerializer
} = require('prosemirror-markdown');

// We need to create a new schema with our customizations, though
const { Schema } = require('prosemirror-model');

const md = new MarkdownIt('commonmark', { html: false });

// Container module with our custom fenced blocks
md.use(container, 'warning', {
  validate: params => /^(spoiler|nsfw)$/.test(params.trim()) || /^warning\s+\S{1}.*$/.test(params.trim())
});

md.use(html5Media);

// <video> and <audio> schema are largely identical
const getMediaSchema = type =>
  ({
    inline: true,
    attrs: {
      src: {},
      title: { default: null },
      description: { default: null }
    },
    group: "inline",
    draggable: true,
    parseDOM: [{
      tag: `${type}[src]`,
      getAttrs(dom) {
        return {
          src: dom.getAttribute("src"),
          title: dom.getAttribute("title")
        };
      }
    }],
    toDOM(node) {
      // Fallback description is omitted in RTE view, no point since user
      // must be able to play HTML5 media in order to insert them
      return [type, {
        src: node.attrs.src,
        title: node.attrs.title,
        class: `html5-${type}-player-in-editor`,
        controls: true
      }];
    }
  });

// Customize the schema to add a new node type that ProseMirror can understand.
// We treat 'warning' as a top-level group to prevent warnings from being
// nested.
const markdownSchema = new Schema({
  nodes: schema.spec.nodes
    .update('doc', {
      content: '(paragraph | block | warning)+'
    })
    .append({
      video: getMediaSchema('video'),
      audio: getMediaSchema('audio'),
      container_warning: {
        content: "block+",
        group: "warning",
        attrs: { message: { default: "" }, markup: { default: "" } },
        parseDOM: [{ tag: "details" }],
        toDOM(node) {
          return [
            "details",
            {
              open: "true",
              class: "content-warning"
            },
            [
              "summary",
              {
                class: "content-warning-notice",
                style: "pointer-events:none;user-select:none;-moz-user-select:none;",
                contenteditable: "false"
              },
              node.attrs.message
            ],
            [
              "div",
              {
                class: "dangerous-content-in-editor"
              },
              0 // Placeholder for actual content
            ]
          ];
        }
      }
    }),
  marks: schema.spec.marks
});

exports.markdownSchema = markdownSchema;

// Serialize content back into markdown
defaultMarkdownSerializer.nodes['container_warning'] = (state, node) => {
  state.write(`::: ${node.attrs.markup}\n\n`);
  state.renderContent(node);
  state.write(':::');
  state.closeBlock(node);
};

defaultMarkdownSerializer.nodes.video = defaultMarkdownSerializer.nodes.audio =
  (state, node) => {
    const escapeQuotes = (str) => str.replace(/(["'])/g, '\\$&');
    const title = node.attrs.title ? ` "${escapeQuotes(node.attrs.title)}"` : '';
    state.write(`![${node.attrs.description || ''}](${node.attrs.src}${title})`);
  };

exports.markdownSerializer = defaultMarkdownSerializer;

const defaultMarkdownParserTokens = defaultMarkdownParser.tokens;

// Translate tokens from markdown parser into metadata for the ProseMirror node

const getMediaParserTokens = type => ({
  node: type,
  getAttrs: tok => ({
    src: tok.attrGet("src"),
    title: tok.attrGet("title") || null,
    description: (tok.children[0] && tok.children[0].content) || null
  })
});

defaultMarkdownParserTokens.video = getMediaParserTokens('video');
defaultMarkdownParserTokens.audio = getMediaParserTokens('audio');

defaultMarkdownParserTokens.container_warning = {
  block: "container_warning",
  attrs: tok => {
    let info = tok.info.trim(),
      rv = {};
    rv.markup = info;
    if (info === 'spoiler' || info === 'nsfw') {
      rv.message = libreviews.msg(`${info} warning`);
    } else if (/^warning\s+\S{1}.*/.test(info)) {
      rv.message = (info.match(/^warning\s+(\S{1}.*)$/) || [])[1];
    }
    return rv;
  }
};

const markdownParser = new MarkdownParser(markdownSchema, md, defaultMarkdownParserTokens);

exports.markdownParser = markdownParser;
