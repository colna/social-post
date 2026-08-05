import { Controller, Get } from '@nestjs/common';
import { PlatformService } from './platform.service';

@Controller('platforms')
export class PlatformController {
  constructor(private readonly platformService: PlatformService) {}

  @Get()
  list() {
    return this.platformService.list();
  }
}
