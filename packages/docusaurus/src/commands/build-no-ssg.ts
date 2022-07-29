/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import fs from 'fs-extra';
import path from 'path';
import logger from '@docusaurus/logger';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import webpack from 'webpack';
import merge from 'webpack-merge';
import {load, type LoadContextOptions} from '../server/index';
import createClientConfig from '../webpack/client';
import {applyConfigureWebpack, applyConfigurePostCss} from '../webpack/utils';

export type BuildNoSSROptions = Pick<
  LoadContextOptions,
  'locale' | 'config'
> & {
  minify?: boolean;
};

export async function buildNoSSG(
  siteDirParam: string = '.',
  cliOptions: Partial<BuildNoSSROptions> = {},
): Promise<void> {
  const siteDir = await fs.realpath(siteDirParam);

  process.env.NODE_ENV = 'production';
  process.env.BABEL_ENV = 'production';
  logger.info(
    'Building website for production without server-side generation...',
  );

  function loadSite() {
    return load({
      siteDir,
      config: cliOptions.config,
      locale: cliOptions.locale,
      localizePath: undefined, // Should this be configurable?
    });
  }

  // Process all related files as a prop.
  const props = await loadSite();

  const {headTags, preBodyTags, postBodyTags} = props;
  const {siteConfig, plugins} = props;

  let config: webpack.Configuration = merge(
    await createClientConfig(props, cliOptions.minify),
    {
      mode: 'production',
      infrastructureLogging: {
        // Reduce log verbosity, see https://github.com/facebook/docusaurus/pull/5420#issuecomment-906613105
        level: 'warn',
      },
      plugins: [
        // Generates an `index.html` file with the <script> injected.
        new HtmlWebpackPlugin({
          template: path.join(
            __dirname,
            '../webpack/templates/index.html.template.ejs',
          ),
          // So we can define the position where the scripts are injected.
          inject: false,
          filename: 'index.html',
          title: siteConfig.title,
          headTags,
          preBodyTags,
          postBodyTags,
        }),
      ],
    },
  );

  // Plugin Lifecycle - configureWebpack and configurePostCss.
  plugins.forEach((plugin) => {
    const {configureWebpack, configurePostCss} = plugin;

    if (configurePostCss) {
      config = applyConfigurePostCss(configurePostCss.bind(plugin), config);
    }

    if (configureWebpack) {
      config = applyConfigureWebpack(
        configureWebpack.bind(plugin), // The plugin lifecycle may reference `this`.
        config,
        false,
        props.siteConfig.webpack?.jsLoader,
        plugin.content,
      );
    }
  });

  const compiler = webpack(config);

  if (process.env.E2E_TEST) {
    compiler.hooks.done.tap('done', (stats) => {
      if (stats.hasErrors()) {
        logger.error('E2E_TEST: Project has compiler errors.');
        process.exit(1);
      }
      logger.success('E2E_TEST: Project can compile.');
      process.exit(0);
    });
  }

  compiler.run((err) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
  });
}
