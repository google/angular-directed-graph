/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {Injectable, NgModule} from '@angular/core';

/**
 * Wraps the native Window object.
 */
@Injectable()
export class WindowRef {
  readonly native: Window = window;
}

/**
 * Wraps the native Document object.
 */
@Injectable()
export class DocumentRef {
  readonly native: Document = document;
}

// Looking for DocumentRef? Use:
// https://github.com/angular/angular/blob/d1ea1f4c7f3358b730b0d94e65b00bc28cae279c/packages/common/src/dom_tokens.ts

/**
 * Provides injectable wrappers around the browser's native window and
 * document objects. These can be used in place of global objects in code
 * to make them more testable.
 */
@NgModule({providers: [DocumentRef, WindowRef]})
export class WindowModule {
}
