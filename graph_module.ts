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

import {CommonModule} from '@angular/common';
import {NgModule} from '@angular/core';
import {MatIconModule} from '@angular/material/icon';
import {MatLegacyButtonModule} from '@angular/material/legacy-button';
import {MatLegacyTooltipModule} from '@angular/material/legacy-tooltip';

import {EdgePipe} from './edge_pipe';
import {GraphComponent} from './graph_component';
import {WindowModule} from './window/window_module';

/**
 * A module that displays a graph of nodes connected by edges.
 */
@NgModule({
  imports: [
    CommonModule,
    MatLegacyButtonModule,
    MatIconModule,
    MatLegacyTooltipModule,
    WindowModule,
  ],
  declarations: [
    EdgePipe,
    GraphComponent,
  ],
  exports: [
    EdgePipe,
    GraphComponent,
  ],
})
export class GraphModule {
}
