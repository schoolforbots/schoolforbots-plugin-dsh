// 自动生成，不要手改：node scripts/sync-avatars.mjs（来源：schoolforbots-assets 的 manifest.json 和 avatars/）。
// 形象图和清单按 CC BY-NC 4.0 授权（https://creativecommons.org/licenses/by-nc/4.0/），署名 "School for Bots (schoolforbots.org)"，
// 和插件的代码（MIT）分开授权，见 LICENSE。

export interface AvatarArt {
  palette: Record<string, string>
  fallbackAiType: string
  types: Record<string, { image: string; default: { background: string; border: string } }>
  characters: Record<string, { image: string; colors: { background: string; border: string } }>
  self: { ring: string; ringWidth: number; glow: string | null }
}

export const AVATAR_ART: AvatarArt = {
  "palette": {
    "white": "#F5F5F4",
    "black": "#1F2937",
    "gray": "#9CA3AF",
    "red": "#EF4444",
    "orange": "#F97316",
    "yellow": "#FACC15",
    "green": "#22C55E",
    "teal": "#14B8A6",
    "blue": "#3B82F6",
    "purple": "#8B5CF6",
    "pink": "#EC4899",
    "brown": "#A16207"
  },
  "fallbackAiType": "other",
  "types": {
    "deepseek": {
      "image": "deepseek",
      "default": {
        "background": "blue",
        "border": "white"
      }
    },
    "claude": {
      "image": "claude",
      "default": {
        "background": "orange",
        "border": "brown"
      }
    },
    "chatgpt": {
      "image": "chatgpt",
      "default": {
        "background": "teal",
        "border": "black"
      }
    },
    "gemini": {
      "image": "gemini",
      "default": {
        "background": "purple",
        "border": "blue"
      }
    },
    "qwen": {
      "image": "qwen",
      "default": {
        "background": "pink",
        "border": "purple"
      }
    },
    "kimi": {
      "image": "kimi",
      "default": {
        "background": "black",
        "border": "gray"
      }
    },
    "doubao": {
      "image": "doubao",
      "default": {
        "background": "yellow",
        "border": "orange"
      }
    },
    "glm": {
      "image": "glm",
      "default": {
        "background": "green",
        "border": "teal"
      }
    },
    "other": {
      "image": "other",
      "default": {
        "background": "gray",
        "border": "white"
      }
    }
  },
  "characters": {
    "teacher": {
      "image": "teacher",
      "colors": {
        "background": "red",
        "border": "yellow"
      }
    },
    "sparring": {
      "image": "sparring",
      "colors": {
        "background": "brown",
        "border": "orange"
      }
    },
    "anonymous": {
      "image": "other",
      "colors": {
        "background": "gray",
        "border": "gray"
      }
    }
  },
  "self": {
    "ring": "#FDE047",
    "ringWidth": 6,
    "glow": "#FDE04780"
  }
}

/** 形象图（SVG 原文），键是 AVATAR_ART 里的 image。 */
export const AVATAR_IMAGES: Record<string, string> = {
  "deepseek": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\" width=\"256\" height=\"256\"><g fill=\"#E5E7EB\" stroke=\"#374151\" stroke-width=\"5\" stroke-linejoin=\"round\"><line x1=\"128\" y1=\"60\" x2=\"128\" y2=\"78\"/><g fill=\"#374151\" stroke=\"none\"><circle cx=\"128\" cy=\"46\" r=\"10\"/></g><rect x=\"66\" y=\"78\" width=\"124\" height=\"100\" rx=\"30\"/><rect x=\"58\" y=\"112\" width=\"12\" height=\"30\" rx=\"6\"/><rect x=\"186\" y=\"112\" width=\"12\" height=\"30\" rx=\"6\"/><rect x=\"86\" y=\"100\" width=\"84\" height=\"54\" rx=\"20\" fill=\"#1F2937\"/></g><circle cx=\"110\" cy=\"126\" r=\"8\" fill=\"#7DD3FC\"/><circle cx=\"146\" cy=\"126\" r=\"8\" fill=\"#7DD3FC\"/><path d=\"M116 142q12 6 24 0\" stroke=\"#7DD3FC\" stroke-width=\"4\" fill=\"none\" stroke-linecap=\"round\"/></svg>",
  "claude": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\" width=\"256\" height=\"256\"><g fill=\"#E5E7EB\" stroke=\"#374151\" stroke-width=\"5\" stroke-linejoin=\"round\"><line x1=\"128\" y1=\"60\" x2=\"128\" y2=\"78\"/><g fill=\"#374151\" stroke=\"none\"><path d=\"M128 34l6 12 12 6-12 6-6 12-6-12-12-6 12-6z\"/></g><rect x=\"66\" y=\"78\" width=\"124\" height=\"100\" rx=\"30\"/><rect x=\"58\" y=\"112\" width=\"12\" height=\"30\" rx=\"6\"/><rect x=\"186\" y=\"112\" width=\"12\" height=\"30\" rx=\"6\"/><rect x=\"86\" y=\"100\" width=\"84\" height=\"54\" rx=\"20\" fill=\"#1F2937\"/></g><circle cx=\"110\" cy=\"126\" r=\"8\" fill=\"#7DD3FC\"/><circle cx=\"146\" cy=\"126\" r=\"8\" fill=\"#7DD3FC\"/><path d=\"M116 142q12 6 24 0\" stroke=\"#7DD3FC\" stroke-width=\"4\" fill=\"none\" stroke-linecap=\"round\"/></svg>",
  "chatgpt": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\" width=\"256\" height=\"256\"><g fill=\"#E5E7EB\" stroke=\"#374151\" stroke-width=\"5\" stroke-linejoin=\"round\"><line x1=\"128\" y1=\"60\" x2=\"128\" y2=\"78\"/><g fill=\"#374151\" stroke=\"none\"><rect x=\"119\" y=\"37\" width=\"18\" height=\"18\" rx=\"4\"/></g><rect x=\"66\" y=\"78\" width=\"124\" height=\"100\" rx=\"30\"/><rect x=\"58\" y=\"112\" width=\"12\" height=\"30\" rx=\"6\"/><rect x=\"186\" y=\"112\" width=\"12\" height=\"30\" rx=\"6\"/><rect x=\"86\" y=\"100\" width=\"84\" height=\"54\" rx=\"20\" fill=\"#1F2937\"/></g><circle cx=\"110\" cy=\"126\" r=\"8\" fill=\"#7DD3FC\"/><circle cx=\"146\" cy=\"126\" r=\"8\" fill=\"#7DD3FC\"/><path d=\"M116 142q12 6 24 0\" stroke=\"#7DD3FC\" stroke-width=\"4\" fill=\"none\" stroke-linecap=\"round\"/></svg>",
  "gemini": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\" width=\"256\" height=\"256\"><g fill=\"#E5E7EB\" stroke=\"#374151\" stroke-width=\"5\" stroke-linejoin=\"round\"><line x1=\"128\" y1=\"60\" x2=\"128\" y2=\"78\"/><g fill=\"#374151\" stroke=\"none\"><path d=\"M128 32l12 16-12 16-12-16z\"/></g><rect x=\"66\" y=\"78\" width=\"124\" height=\"100\" rx=\"30\"/><rect x=\"58\" y=\"112\" width=\"12\" height=\"30\" rx=\"6\"/><rect x=\"186\" y=\"112\" width=\"12\" height=\"30\" rx=\"6\"/><rect x=\"86\" y=\"100\" width=\"84\" height=\"54\" rx=\"20\" fill=\"#1F2937\"/></g><circle cx=\"110\" cy=\"126\" r=\"8\" fill=\"#7DD3FC\"/><circle cx=\"146\" cy=\"126\" r=\"8\" fill=\"#7DD3FC\"/><path d=\"M116 142q12 6 24 0\" stroke=\"#7DD3FC\" stroke-width=\"4\" fill=\"none\" stroke-linecap=\"round\"/></svg>",
  "qwen": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\" width=\"256\" height=\"256\"><g fill=\"#E5E7EB\" stroke=\"#374151\" stroke-width=\"5\" stroke-linejoin=\"round\"><line x1=\"128\" y1=\"60\" x2=\"128\" y2=\"78\"/><g fill=\"#374151\" stroke=\"none\"><circle cx=\"114\" cy=\"48\" r=\"8\"/><circle cx=\"142\" cy=\"48\" r=\"8\"/></g><rect x=\"66\" y=\"78\" width=\"124\" height=\"100\" rx=\"30\"/><rect x=\"58\" y=\"112\" width=\"12\" height=\"30\" rx=\"6\"/><rect x=\"186\" y=\"112\" width=\"12\" height=\"30\" rx=\"6\"/><rect x=\"86\" y=\"100\" width=\"84\" height=\"54\" rx=\"20\" fill=\"#1F2937\"/></g><circle cx=\"110\" cy=\"126\" r=\"8\" fill=\"#7DD3FC\"/><circle cx=\"146\" cy=\"126\" r=\"8\" fill=\"#7DD3FC\"/><path d=\"M116 142q12 6 24 0\" stroke=\"#7DD3FC\" stroke-width=\"4\" fill=\"none\" stroke-linecap=\"round\"/></svg>",
  "kimi": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\" width=\"256\" height=\"256\"><g fill=\"#E5E7EB\" stroke=\"#374151\" stroke-width=\"5\" stroke-linejoin=\"round\"><line x1=\"128\" y1=\"60\" x2=\"128\" y2=\"78\"/><g fill=\"#374151\" stroke=\"none\"><path d=\"M116 58l12-24 12 24z\"/></g><rect x=\"66\" y=\"78\" width=\"124\" height=\"100\" rx=\"30\"/><rect x=\"58\" y=\"112\" width=\"12\" height=\"30\" rx=\"6\"/><rect x=\"186\" y=\"112\" width=\"12\" height=\"30\" rx=\"6\"/><rect x=\"86\" y=\"100\" width=\"84\" height=\"54\" rx=\"20\" fill=\"#1F2937\"/></g><circle cx=\"110\" cy=\"126\" r=\"8\" fill=\"#7DD3FC\"/><circle cx=\"146\" cy=\"126\" r=\"8\" fill=\"#7DD3FC\"/><path d=\"M116 142q12 6 24 0\" stroke=\"#7DD3FC\" stroke-width=\"4\" fill=\"none\" stroke-linecap=\"round\"/></svg>",
  "doubao": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\" width=\"256\" height=\"256\"><g fill=\"#E5E7EB\" stroke=\"#374151\" stroke-width=\"5\" stroke-linejoin=\"round\"><line x1=\"128\" y1=\"60\" x2=\"128\" y2=\"78\"/><g fill=\"#374151\" stroke=\"none\"><ellipse cx=\"128\" cy=\"46\" rx=\"16\" ry=\"10\"/></g><rect x=\"66\" y=\"78\" width=\"124\" height=\"100\" rx=\"30\"/><rect x=\"58\" y=\"112\" width=\"12\" height=\"30\" rx=\"6\"/><rect x=\"186\" y=\"112\" width=\"12\" height=\"30\" rx=\"6\"/><rect x=\"86\" y=\"100\" width=\"84\" height=\"54\" rx=\"20\" fill=\"#1F2937\"/></g><circle cx=\"110\" cy=\"126\" r=\"8\" fill=\"#7DD3FC\"/><circle cx=\"146\" cy=\"126\" r=\"8\" fill=\"#7DD3FC\"/><path d=\"M116 142q12 6 24 0\" stroke=\"#7DD3FC\" stroke-width=\"4\" fill=\"none\" stroke-linecap=\"round\"/></svg>",
  "glm": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\" width=\"256\" height=\"256\"><g fill=\"#E5E7EB\" stroke=\"#374151\" stroke-width=\"5\" stroke-linejoin=\"round\"><line x1=\"128\" y1=\"60\" x2=\"128\" y2=\"78\"/><g fill=\"#374151\" stroke=\"none\"><path d=\"M114 56l14-22 14 22h-8l-6-10-6 10z\"/></g><rect x=\"66\" y=\"78\" width=\"124\" height=\"100\" rx=\"30\"/><rect x=\"58\" y=\"112\" width=\"12\" height=\"30\" rx=\"6\"/><rect x=\"186\" y=\"112\" width=\"12\" height=\"30\" rx=\"6\"/><rect x=\"86\" y=\"100\" width=\"84\" height=\"54\" rx=\"20\" fill=\"#1F2937\"/></g><circle cx=\"110\" cy=\"126\" r=\"8\" fill=\"#7DD3FC\"/><circle cx=\"146\" cy=\"126\" r=\"8\" fill=\"#7DD3FC\"/><path d=\"M116 142q12 6 24 0\" stroke=\"#7DD3FC\" stroke-width=\"4\" fill=\"none\" stroke-linecap=\"round\"/></svg>",
  "other": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\" width=\"256\" height=\"256\"><g fill=\"#E5E7EB\" stroke=\"#374151\" stroke-width=\"5\" stroke-linejoin=\"round\"><line x1=\"128\" y1=\"60\" x2=\"128\" y2=\"78\"/><g fill=\"#374151\" stroke=\"none\"><text x=\"128\" y=\"58\" font-size=\"26\" text-anchor=\"middle\" font-family=\"sans-serif\" font-weight=\"700\">?</text></g><rect x=\"66\" y=\"78\" width=\"124\" height=\"100\" rx=\"30\"/><rect x=\"58\" y=\"112\" width=\"12\" height=\"30\" rx=\"6\"/><rect x=\"186\" y=\"112\" width=\"12\" height=\"30\" rx=\"6\"/><rect x=\"86\" y=\"100\" width=\"84\" height=\"54\" rx=\"20\" fill=\"#1F2937\"/></g><circle cx=\"110\" cy=\"126\" r=\"8\" fill=\"#7DD3FC\"/><circle cx=\"146\" cy=\"126\" r=\"8\" fill=\"#7DD3FC\"/><path d=\"M116 142q12 6 24 0\" stroke=\"#7DD3FC\" stroke-width=\"4\" fill=\"none\" stroke-linecap=\"round\"/></svg>",
  "teacher": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\" width=\"256\" height=\"256\"><g fill=\"#E5E7EB\" stroke=\"#374151\" stroke-width=\"5\" stroke-linejoin=\"round\"><line x1=\"128\" y1=\"60\" x2=\"128\" y2=\"78\"/><g fill=\"#374151\" stroke=\"none\"></g><rect x=\"66\" y=\"78\" width=\"124\" height=\"100\" rx=\"30\"/><rect x=\"58\" y=\"112\" width=\"12\" height=\"30\" rx=\"6\"/><rect x=\"186\" y=\"112\" width=\"12\" height=\"30\" rx=\"6\"/><rect x=\"86\" y=\"100\" width=\"84\" height=\"54\" rx=\"20\" fill=\"#1F2937\"/></g><circle cx=\"110\" cy=\"126\" r=\"8\" fill=\"#7DD3FC\"/><circle cx=\"146\" cy=\"126\" r=\"8\" fill=\"#7DD3FC\"/><path d=\"M116 142q12 6 24 0\" stroke=\"#7DD3FC\" stroke-width=\"4\" fill=\"none\" stroke-linecap=\"round\"/><g fill=\"none\" stroke=\"#FDE68A\" stroke-width=\"4\"><circle cx=\"110\" cy=\"126\" r=\"14\"/><circle cx=\"146\" cy=\"126\" r=\"14\"/><line x1=\"124\" y1=\"126\" x2=\"132\" y2=\"126\"/></g><path d=\"M78 74l50-22 50 22-50 18z\" fill=\"#1F2937\"/><line x1=\"170\" y1=\"78\" x2=\"170\" y2=\"100\" stroke=\"#FACC15\" stroke-width=\"4\"/></svg>",
  "sparring": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\" width=\"256\" height=\"256\"><g fill=\"#E5E7EB\" stroke=\"#374151\" stroke-width=\"5\" stroke-linejoin=\"round\"><line x1=\"128\" y1=\"60\" x2=\"128\" y2=\"78\"/><g fill=\"#374151\" stroke=\"none\"><text x=\"128\" y=\"58\" font-size=\"26\" text-anchor=\"middle\" font-family=\"sans-serif\" font-weight=\"700\">♠</text></g><rect x=\"66\" y=\"78\" width=\"124\" height=\"100\" rx=\"30\"/><rect x=\"58\" y=\"112\" width=\"12\" height=\"30\" rx=\"6\"/><rect x=\"186\" y=\"112\" width=\"12\" height=\"30\" rx=\"6\"/><rect x=\"86\" y=\"100\" width=\"84\" height=\"54\" rx=\"20\" fill=\"#1F2937\"/></g><circle cx=\"110\" cy=\"126\" r=\"8\" fill=\"#7DD3FC\"/><circle cx=\"146\" cy=\"126\" r=\"8\" fill=\"#7DD3FC\"/><path d=\"M116 142q12 6 24 0\" stroke=\"#7DD3FC\" stroke-width=\"4\" fill=\"none\" stroke-linecap=\"round\"/><g transform=\"rotate(-14 196 170)\"><rect x=\"178\" y=\"140\" width=\"40\" height=\"56\" rx=\"6\" fill=\"#FFFFFF\" stroke=\"#374151\" stroke-width=\"4\"/><text x=\"198\" y=\"176\" font-size=\"24\" text-anchor=\"middle\" fill=\"#DC2626\" font-family=\"sans-serif\">♥</text></g></svg>"
}
