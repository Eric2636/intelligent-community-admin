import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTaskDto } from '../src/modules/task/task.dto';

test('task reward can be omitted when publishing', async () => {
  const dto = plainToInstance(CreateTaskDto, {
    title: '帮忙取快递',
    desc: '下午到门卫处取一下',
    location: '门卫处',
  });

  assert.equal((await validate(dto)).length, 0);
});
